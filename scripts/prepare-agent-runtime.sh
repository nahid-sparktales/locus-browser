#!/bin/zsh
set -euo pipefail
setopt null_glob

script_dir="${0:A:h}"
repo_root="${script_dir:h}"
platform_root="${LOCUS_PLATFORM_ROOT:-${repo_root:h}/locus-platform}"
agent_root="${platform_root}/agent"
cache="${repo_root}/.agent-runtime"
stage="${repo_root}/apps/desktop/build/AgentRuntime"
requirements_lock="${agent_root}/requirements-runtime.lock"
component_manifest="${agent_root}/ollama_code/runtime_components/codex-app-server.json"
speech_manifest="${agent_root}/ollama_code/runtime_components/whisper-cpp.json"
temporary_paths=()
cleanup() {
  for path in "${temporary_paths[@]}"; do
    [[ -n "${path}" ]] && /bin/rm -rf "${path}"
  done
}
trap cleanup EXIT

[[ "$(/usr/bin/uname -s)" == "Darwin" ]] || {
  echo "error: the first canary runtime target is macOS" >&2
  exit 1
}
[[ -f "${agent_root}/pyproject.toml" && -f "${requirements_lock}" \
    && -f "${component_manifest}" && -f "${speech_manifest}" ]] || {
  echo "error: locus-platform agent runtime is missing at ${agent_root}" >&2
  exit 1
}

host_arch="$(/usr/bin/uname -m)"
target_arch="${LOCUS_TARGET_ARCH:-${host_arch}}"
pbs_tag="${LOCUS_PBS_TAG:-20260728}"
py_version="${LOCUS_PBS_PYTHON:-3.14.6}"
case "${target_arch}" in
  arm64)
    pbs_arch="aarch64"
    pbs_sha256="f4b47659e2da4b97f38cefdf5ad19f0042946099d843cde60de308708e5b1ac5"
    ;;
  *) echo "error: Locus Browser canary supports Apple Silicon only" >&2; exit 1 ;;
esac

asset="cpython-${py_version}+${pbs_tag}-${pbs_arch}-apple-darwin-install_only_stripped.tar.gz"
url="https://github.com/astral-sh/python-build-standalone/releases/download/${pbs_tag}/${asset}"
manifest_hash="$(
  /usr/bin/shasum -a 256 "${agent_root}/pyproject.toml" "${requirements_lock}" \
    | /usr/bin/shasum -a 256 | /usr/bin/cut -d' ' -f1
)"
stamp_value="v1 ${asset} ${pbs_sha256} ${manifest_hash}"

if [[ ! -x "${cache}/cpython/bin/python3" || ! -d "${cache}/site-packages" \
    || ! -f "${cache}/.stamp" || "$(<"${cache}/.stamp")" != "${stamp_value}" ]]; then
  workdir="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/locus-browser-runtime.XXXXXX")"
  temporary_paths+=("${workdir}")
  /usr/bin/curl -fsSL --retry 3 -o "${workdir}/${asset}" "${url}"
  actual="$(/usr/bin/shasum -a 256 "${workdir}/${asset}" | /usr/bin/cut -d' ' -f1)"
  [[ "${actual}" == "${pbs_sha256}" ]] || { echo "error: pinned CPython checksum mismatch" >&2; exit 1; }
  /usr/bin/tar -xzf "${workdir}/${asset}" -C "${workdir}"
  /bin/mkdir -p "${workdir}/site-packages"
  if [[ "${host_arch}" == "${target_arch}" ]]; then
    "${workdir}/python/bin/python3" -m pip install --quiet \
      --require-hashes --only-binary=:all: --target "${workdir}/site-packages" \
      --requirement "${requirements_lock}"
  else
    host_python="$(command -v "${LOCUS_HOST_PYTHON:-python3}")"
    [[ -x "${host_python}" ]] || { echo "error: a host Python with pip is required for cross-building" >&2; exit 1; }
    "${host_python}" -m pip install --quiet \
      --require-hashes --only-binary=:all: --platform macosx_14_0_arm64 \
      --python-version 3.14 --implementation cp --abi cp314 \
      --target "${workdir}/site-packages" --requirement "${requirements_lock}"
  fi
  /bin/rm -rf "${workdir}/site-packages/bin"
  if [[ "${host_arch}" == "${target_arch}" ]]; then
    "${workdir}/python/bin/python3" -m compileall -q -j 0 \
      "${workdir}/python/lib" "${workdir}/site-packages"
  fi
  /bin/rm -rf "${cache}"
  /bin/mkdir -p "${cache}"
  /usr/bin/ditto --norsrc --noextattr --noqtn "${workdir}/python" "${cache}/cpython"
  /usr/bin/ditto --norsrc --noextattr --noqtn "${workdir}/site-packages" "${cache}/site-packages"
  print -r -- "${stamp_value}" > "${cache}/.stamp"
fi

/bin/rm -rf "${stage}"
/bin/mkdir -p "${stage}/source"
/usr/bin/ditto --norsrc --noextattr --noqtn "${agent_root}/ollama_code" "${stage}/source/ollama_code"
/usr/bin/ditto --norsrc --noextattr --noqtn "${cache}/cpython" "${stage}/python"
/usr/bin/ditto --norsrc --noextattr --noqtn "${cache}/site-packages" "${stage}/site-packages"
node "${repo_root}/scripts/prepare-managed-component.mjs" \
  --manifest "${component_manifest}" \
  --cache "${cache}/managed-components" \
  --destination "${stage}/components/codex-app-server" \
  --license "${platform_root}/LICENSE"

speech_version="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "${speech_manifest}")"
speech_url="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["source_url"])' "${speech_manifest}")"
speech_sha256="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["source_sha256"])' "${speech_manifest}")"
speech_cache="${cache}/whisper-cpp-${speech_version}"
speech_cpu_baseline="armv8.2-a+dotprod"
speech_build_contract="v2 ${speech_sha256} metal ${speech_cpu_baseline}"
if [[ ! -x "${speech_cache}/whisper-cli" || ! -f "${speech_cache}/.stamp" \
    || "$(<"${speech_cache}/.stamp")" != "${speech_build_contract}" ]]; then
  speech_work="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/locus-whisper-build.XXXXXX")"
  temporary_paths+=("${speech_work}")
  /usr/bin/curl -fsSL --retry 3 -o "${speech_work}/source.tar.gz" "${speech_url}"
  speech_actual="$(/usr/bin/shasum -a 256 "${speech_work}/source.tar.gz" | /usr/bin/cut -d' ' -f1)"
  [[ "${speech_actual}" == "${speech_sha256}" ]] || { echo "error: pinned whisper.cpp checksum mismatch" >&2; exit 1; }
  /usr/bin/tar -xzf "${speech_work}/source.tar.gz" -C "${speech_work}"
  speech_source=("${speech_work}"/whisper.cpp-*(N/))
  [[ ${#speech_source[@]} -eq 1 ]] || { echo "error: whisper.cpp source archive is malformed" >&2; exit 1; }
  speech_cmake="$(command -v cmake || true)"
  [[ -x "${speech_cmake}" ]] || { echo "error: cmake is required to build the on-device speech component" >&2; exit 1; }
  "${speech_cmake}" -S "${speech_source[1]}" -B "${speech_work}/build" \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_METAL=ON \
    -DGGML_NATIVE=OFF -DGGML_CPU_ARM_ARCH="${speech_cpu_baseline}"
  "${speech_cmake}" --build "${speech_work}/build" --config Release --target whisper-cli -j "$(/usr/sbin/sysctl -n hw.ncpu)"
  /bin/mkdir -p "${speech_cache}"
  /usr/bin/ditto --norsrc --noextattr --noqtn "${speech_work}/build/bin/whisper-cli" "${speech_cache}/whisper-cli"
  /usr/bin/ditto --norsrc --noextattr --noqtn "${speech_source[1]}/LICENSE" "${speech_cache}/LICENSE"
  print -r -- "${speech_build_contract}" > "${speech_cache}/.stamp"
fi
/bin/mkdir -p "${stage}/components/whisper"
/usr/bin/ditto --norsrc --noextattr --noqtn "${speech_cache}/whisper-cli" "${stage}/components/whisper/whisper-cli"
/usr/bin/ditto --norsrc --noextattr --noqtn "${speech_cache}/LICENSE" "${stage}/components/whisper/LICENSE"
/usr/bin/ditto --norsrc --noextattr --noqtn "${speech_manifest}" "${stage}/components/whisper/manifest.json"

semantic_swift="$(/usr/bin/xcrun --find swift)"
[[ -x "${semantic_swift}" && -f "${platform_root}/Sources/LocusSemanticHelper/main.swift" ]] || {
  echo "error: the signed semantic helper source is missing from locus-platform" >&2
  exit 1
}
"${semantic_swift}" build --package-path "${platform_root}" -c release --product locus-semantic-helper
semantic_helper="${platform_root}/.build/release/locus-semantic-helper"
[[ -x "${semantic_helper}" ]] || { echo "error: semantic helper build did not produce an executable" >&2; exit 1; }
/bin/mkdir -p "${stage}/components/semantic"
/usr/bin/ditto --norsrc --noextattr --noqtn "${semantic_helper}" "${stage}/components/semantic/locus-semantic-helper"
/usr/bin/ditto --norsrc --noextattr --noqtn "${platform_root}/LICENSE" "${stage}/components/semantic/LICENSE"

for junk in "${stage}/source/ollama_code"/**/__pycache__(N/); do /bin/rm -rf "${junk}"; done
for lib_dir in "${stage}/python/lib"/python3.*(N/); do
  /bin/rm -rf "${lib_dir}/dbm" "${lib_dir}/tkinter" "${lib_dir}/test" \
    "${lib_dir}/idlelib" "${lib_dir}/turtledemo" "${lib_dir}/ensurepip" \
    "${lib_dir}/pydoc_data" "${lib_dir}/site-packages"
  /bin/mkdir -p "${lib_dir}/site-packages"
  /bin/rm -f "${lib_dir}/lib-dynload"/_dbm*.so(N) "${lib_dir}/lib-dynload"/_tkinter*.so(N)
done
for prune in "${stage}/python/lib"/tcl*(N) "${stage}/python/lib"/tk*(N) \
  "${stage}/python/lib"/itcl*(N) "${stage}/python/lib"/libtcl*(N) \
  "${stage}/python/lib"/libtk*(N) "${stage}/python/include" "${stage}/python/share"; do
  /bin/rm -rf "${prune}"
done
for bin_entry in "${stage}/python/bin"/*(N); do
  case "${bin_entry:t}" in python3|python3.<->) ;; *) /bin/rm -f "${bin_entry}" ;; esac
done

if [[ "${host_arch}" == "${target_arch}" ]]; then
  "${stage}/python/bin/python3" -m compileall -q "${stage}/source"
fi
/usr/bin/xattr -cr "${stage}"
revision="$(/usr/bin/git -C "${platform_root}" rev-parse HEAD)"
{
  echo "platform_revision=${revision}"
  echo "python_asset=${asset}"
  echo "python_sha256=${pbs_sha256}"
  echo "requirements_sha256=$(/usr/bin/shasum -a 256 "${requirements_lock}" | /usr/bin/cut -d' ' -f1)"
  echo "codex_component_manifest_sha256=$(/usr/bin/shasum -a 256 "${component_manifest}" | /usr/bin/cut -d' ' -f1)"
  echo "whisper_component_manifest_sha256=$(/usr/bin/shasum -a 256 "${speech_manifest}" | /usr/bin/cut -d' ' -f1)"
  echo "semantic_helper_sha256=$(/usr/bin/shasum -a 256 "${stage}/components/semantic/locus-semantic-helper" | /usr/bin/cut -d' ' -f1)"
} > "${stage}/PROVENANCE"
echo "Self-contained agent runtime staged at ${stage}."
