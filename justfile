# Maintenance commands for the "mine" fork branch.

set shell := ["bash", "-euo", "pipefail", "-c"]

fork_repo := "gstark/t3code"
tap := "gstark/tap"
cask := "t3-code-mine"
signing_identity := "Gavin Stark (JBRC9C74U7)"
release_base_url := "https://github.com/gstark/t3code/releases/download"
# Hosts whose `t3 service` runs the mine build. `just remotes` updates them.
remote_hosts := "o4s-dev dds-dev"

default:
    @just --list

# Fetch upstream branches and tags, fast-forward main, and push main to the fork
sync:
    #!/usr/bin/env bash
    set -euo pipefail
    git fetch upstream --tags --prune
    if [[ "$(git branch --show-current)" == "main" ]]; then
      git merge --ff-only upstream/main
    else
      git fetch upstream main:main
    fi
    git push origin main
    echo "Latest official release: $(just _latest-release)"

# Merge the newest official upstream release into mine; Claude resolves conflicts
merge-release: sync _require-mine
    #!/usr/bin/env bash
    set -euo pipefail
    latest="$(just _latest-release)"
    if git merge-base --is-ancestor "$latest" HEAD; then
      echo "mine already contains $latest. Nothing to merge."
      exit 0
    fi

    echo "Merging $latest into mine."
    if git merge --no-commit --no-ff -m "Merge upstream $latest into mine" "$latest"; then
      echo "Merged $latest without conflicts."
    else
      echo "Conflicts found. Asking Claude to resolve them."
      UNSLOP_OFF=1 claude -p "You are in the gstark/t3code repository on the 'mine' branch. It is a personal fork of pingdotgg/t3code with custom features. A 'git merge $latest' (the newest official upstream release) stopped with conflicts.

      Resolve every conflicted file:
      - Keep the fork's custom features and take the upstream changes. Combine both sides when they touch the same code.
      - If upstream rewrote code that a fork feature depends on, adapt the fork feature to the new upstream code.
      - For pnpm-lock.yaml, take the upstream version with 'git checkout --theirs pnpm-lock.yaml', then run 'vp i --lockfile-only'.
      - Remove all conflict markers, then run 'git add' on each resolved file.
      - Run 'vp test run <files>' for the tests that cover the code you changed. Run 'vp run <package>#typecheck' for each package you changed. Fix any failures.
      - Do not commit, push, or abort the merge.

      Finish with a short summary of each conflict and how you resolved it." \
        --permission-mode acceptEdits \
        --allowedTools Read Edit Write Grep Glob \
          "Bash(git status:*)" "Bash(git diff:*)" "Bash(git log:*)" "Bash(git show:*)" \
          "Bash(git add:*)" "Bash(git checkout --theirs:*)" "Bash(git checkout --ours:*)" \
          "Bash(vp i --lockfile-only:*)" "Bash(vp test run:*)" "Bash(vp run *#typecheck)"
    fi

    if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
      echo "Unresolved files remain. Fix them, then run 'git commit --no-edit'." >&2
      git diff --name-only --diff-filter=U >&2
      exit 1
    fi
    if git diff --cached | grep -qE '^\+(<{7}|>{7})( |$)'; then
      echo "Conflict markers remain in staged changes. Fix them, then run 'git commit --no-edit'." >&2
      exit 1
    fi
    vp i --frozen-lockfile
    if ! vp run typecheck; then
      echo "Typecheck failed. The merge is not committed. Fix the errors, then run 'git commit --no-edit'." >&2
      exit 1
    fi
    git commit --no-edit
    echo "Merged $latest into mine. Typecheck passed."

# Build the macOS app from mine, publish a GitHub release, and update the Homebrew cask
release: _require-mine
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "$(git status --porcelain)" ]]; then
      echo "The working tree has changes. Commit them first." >&2
      exit 1
    fi

    base="$(node -p "require('./apps/desktop/package.json').version")"
    version="${base}-mine.$(date +%Y%m%d%H%M)"
    tag="v${version}"
    out="release/mine"

    rm -rf "$out"
    pnpm install --frozen-lockfile
    CSC_NAME="{{ signing_identity }}" \
      node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --signed \
      --build-version "$version" --output-dir "$out"

    dmg="$out/T3-Code-${version}-arm64.dmg"
    sha="$(shasum -a 256 "$dmg" | cut -d' ' -f1)"

    git push origin mine
    gh release create "$tag" "$dmg" -R {{ fork_repo }} \
      --target "$(git rev-parse HEAD)" \
      --title "T3 Code (mine) $version" \
      --notes "Build of the mine branch at $(git rev-parse --short HEAD), based on upstream v${base}." \
      --latest=false

    tap_dir="$(brew --repository {{ tap }})"
    git -C "$tap_dir" pull --ff-only
    mkdir -p "$tap_dir/Casks"
    cat > "$tap_dir/Casks/{{ cask }}.rb" <<EOF
    cask "{{ cask }}" do
      version "$version"
      sha256 "$sha"

      url "https://github.com/{{ fork_repo }}/releases/download/v#{version}/T3-Code-#{version}-arm64.dmg"
      name "T3 Code (mine)"
      desc "Personal fork build of T3 Code"
      homepage "https://github.com/{{ fork_repo }}/tree/mine"

      depends_on arch: :arm64
      depends_on macos: :ventura
      conflicts_with cask: "t3-code"

      app "T3 Code (Alpha).app"

      # The build is signed but not notarized, so remove the quarantine flag to let it open.
      postflight do
        system_command "/usr/bin/xattr",
                       args: ["-dr", "com.apple.quarantine", "#{appdir}/T3 Code (Alpha).app"]
      end
    end
    EOF
    git -C "$tap_dir" add "Casks/{{ cask }}.rb"
    git -C "$tap_dir" commit -m "{{ cask }} $version"
    git -C "$tap_dir" push

    echo "Released $version. Run 'just install' and 'just remotes' to install it."

# Install or upgrade the mine build from the Homebrew tap
install:
    #!/usr/bin/env bash
    set -euo pipefail
    brew update
    if brew list --cask {{ cask }} >/dev/null 2>&1; then
      brew upgrade --no-ask --cask {{ cask }}
    else
      brew install --no-ask --cask {{ tap }}/{{ cask }}
    fi
    echo "Quit and reopen T3 Code to use the new build."

# Switch each remote host's background service to a mine release (default: the newest)
remotes version="":
    #!/usr/bin/env bash
    set -euo pipefail
    version="{{ version }}"
    if [[ -z "$version" ]]; then
      version="$(gh release list -R {{ fork_repo }} -L 1 --json tagName -q '.[0].tagName')"
    fi
    version="${version#v}"

    # The mine-cli-archives workflow attaches the Linux archives after `just release`.
    for attempt in $(seq 1 40); do
      if gh release view "v$version" -R {{ fork_repo }} --json assets -q '.assets[].name' | grep -qx SHA256SUMS; then
        break
      fi
      if [[ "$attempt" -eq 40 ]]; then
        echo "v$version has no Linux archives after 20 minutes. Check the 'Mine CLI archives' workflow." >&2
        exit 1
      fi
      echo "Waiting for the Linux archives of v$version..."
      sleep 30
    done

    failed=()
    for host in {{ remote_hosts }}; do
      echo "== $host: updating to $version"
      if ! ssh "$host" "T3CODE_RELEASE_BASE_URL={{ release_base_url }} \$HOME/.local/bin/t3 update $version --yes"; then
        failed+=("$host")
      fi
    done
    if [[ ${#failed[@]} -gt 0 ]]; then
      echo "Update failed on: ${failed[*]}" >&2
      exit 1
    fi

# Merge a new official release, typecheck, release, install, and update remotes. Pass "force" to build even with no new release
update mode="": _require-mine
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "{{ mode }}" && "{{ mode }}" != "force" ]]; then
      echo "Unknown option '{{ mode }}'. Use 'just update' or 'just update force'." >&2
      exit 1
    fi
    before="$(git rev-parse HEAD)"
    just merge-release
    if [[ "$(git rev-parse HEAD)" == "$before" && "{{ mode }}" != "force" ]]; then
      echo "No new official release. Nothing to build."
      exit 0
    fi
    pnpm install --frozen-lockfile
    pnpm typecheck
    just release
    just install
    just remotes

# Print the newest official (non-nightly, non-preview) release tag
_latest-release:
    @git tag -l 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1

_require-mine:
    @[[ "$(git branch --show-current)" == "mine" ]] || { echo "Switch to the mine branch first." >&2; exit 1; }
