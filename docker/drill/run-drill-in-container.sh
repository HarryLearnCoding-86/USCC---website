#!/bin/sh
# docker/drill/run-drill-in-container.sh
# Runs clean-host-drill.sh inside a throwaway Docker-in-Docker container, i.e. a clean Linux host with nothing but
# Docker, git and curl, when no spare VM is at hand. The current branch is handed over as a git bundle, so the
# drill really clones; nothing from the working copy (node_modules, .env, builds) leaks in.
# Usage from the repository root (Git Bash or Linux): sh docker/drill/run-drill-in-container.sh
# The container is removed afterwards unless KEEP_DRILL_HOST=yes.

set -eu
# Git Bash on Windows rewrites arguments like "/drill" into Windows paths; container paths must pass unchanged.
export MSYS_NO_PATHCONV=1

container_name="uscc-clean-host-drill"
branch_name="$(git rev-parse --abbrev-ref HEAD)"
# Relative and git-ignored, so the same path works for Windows git and for docker cp.
bundle_directory=".drill"
mkdir -p "${bundle_directory}"

git bundle create "${bundle_directory}/uscc.bundle" "${branch_name}"
docker rm -f "${container_name}" > /dev/null 2>&1 || true
docker run -d --privileged --name "${container_name}" docker:27-dind > /dev/null
trap '[ "${KEEP_DRILL_HOST:-no}" = "yes" ] || docker rm -f "${container_name}" > /dev/null 2>&1' EXIT

echo "Waiting for the clean host's Docker daemon…"
until docker exec "${container_name}" docker info > /dev/null 2>&1; do sleep 2; done
docker exec "${container_name}" apk add --no-cache git curl > /dev/null
docker exec "${container_name}" mkdir -p /drill
docker cp "${bundle_directory}/uscc.bundle" "${container_name}:/drill/uscc.bundle"
docker cp docker/drill/clean-host-drill.sh "${container_name}:/drill/clean-host-drill.sh"
docker exec "${container_name}" sh /drill/clean-host-drill.sh /drill/uscc.bundle "${branch_name}"
