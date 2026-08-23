set shell := ["bash", "-euo", "pipefail", "-c"]
set windows-shell := ["pwsh", "-NoLogo", "-NoProfile", "-Command"]
npm := if os_family() == "windows" { "npm.cmd" } else { "npm" }
node := if os_family() == "windows" { "node.exe" } else { "node" }
run_if_present := "./scripts/just/run-if-present.mjs"
run_recipes_and_report := "./scripts/just/run-recipes-and-report.mjs"
step := "./scripts/just/step.mjs"

[private]
default:
    @just --list

[private]
_install_deps:
    @{{ node }} {{ step }} "Installing project dependencies"
    @{{ npm }} ci --include=optional

[private]
_code_quality:
    @{{ node }} {{ step }} "Running code quality checks"
    @{{ npm }} exec -- biome check .

[private]
_typecheck:
    @{{ node }} {{ step }} "Running type checks"
    @{{ npm }} exec -- tsc --noEmit

[private]
_test:
    @{{ node }} {{ step }} "Running test suite"
    @{{ npm }} exec -- vitest run --dir src

[private]
_coverage:
    @{{ node }} {{ step }} "Running local test coverage"
    @{{ npm }} exec -- vitest run --coverage --coverage.reporter=text --coverage.reporter=html --coverage.reporter=lcov --dir src

[private]
_ci_coverage:
    @{{ node }} {{ step }} "Generating CI coverage reports"
    @{{ npm }} exec -- vitest run --coverage --coverage.reporter=lcov --coverage.reporter=cobertura --dir src

[private]
_nix_format_check:
    @{{ node }} {{ step }} "Checking Nix formatting"
    @{{ node }} {{ run_if_present }} nixfmt --check --indent=4 flake.nix

[private]
_nix_format_write:
    @{{ node }} {{ step }} "Formatting Nix files"
    @{{ node }} {{ run_if_present }} nixfmt --indent=4 flake.nix

[private]
_nix_project_check:
    @{{ node }} {{ step }} "Running Nix project checks"
    @{{ node }} {{ run_if_present }} nix flake check --no-write-lock-file --print-build-logs

[private]
_fix_source:
    @{{ node }} {{ step }} "Applying safe auto-fixes"
    @{{ npm }} exec -- biome check --write .

[private]
_launch_dev:
    @{{ node }} {{ step }} "Launching pi with this checkout's extension"
    @{{ npm }} run dev

[private]
_run_and_report label *recipes:
    @{{ node }} {{ run_recipes_and_report }} '{{ label }}' {{ recipes }}

# Install lockfile-pinned project dependencies.
install:
    @just _run_and_report 'ci/install' _install_deps

# Run all quality checks.
[group('quality')]
lint:
    @just _run_and_report 'quality/lint' _code_quality _nix_format_check _typecheck

# Run the test suite once.
[group('quality')]
test:
    @just _run_and_report 'quality/test' _test

# Run the test suite with local HTML and LCOV coverage reports.
[group('quality')]
coverage:
    @just _run_and_report 'quality/coverage' _coverage

# Generate LCOV and Cobertura XML coverage reports for CI.
[group('ci')]
ci-coverage:
    @just _run_and_report 'ci/coverage' _ci_coverage

# Run the same install and checks sequence used in CI.
[group('ci')]
ci:
    @just _run_and_report 'ci/ci' _install_deps _code_quality _nix_format_check _typecheck _test _nix_project_check

# Apply safe source and formatting fixes.
[group('quality')]
fmt:
    @just _run_and_report 'quality/fmt' _fix_source _nix_format_write

# Launch the project with only this checkout's extension enabled.
[group('development')]
dev:
    @just _run_and_report 'development/dev' _launch_dev
