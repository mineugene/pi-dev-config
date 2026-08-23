{
    description = "pi coding-agent package and Home Manager module";

    inputs = {
        nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
        pre-commit-hooks = {
            url = "github:cachix/git-hooks.nix";
            inputs.nixpkgs.follows = "nixpkgs";
        };
    };

    outputs =
        {
            self,
            nixpkgs,
            pre-commit-hooks,
            ...
        }:
        let
            inherit (nixpkgs) lib;
            systems = [
                "x86_64-linux"
                "aarch64-linux"
            ];
            eachSystem = builder: lib.genAttrs systems builder;
            pkgsFor = system: nixpkgs.legacyPackages.${system};
        in
        {
            homeModules.default =
                { pkgs, ... }:
                {
                    home.packages = [ self.packages.${pkgs.stdenv.hostPlatform.system}.default ];
                    programs.pi-coding-agent = {
                        enable = true;
                        settings = {
                            packages = [ "https://git.eugenemin.xyz/mineugene/pi-dev-config.git" ];
                            theme = "tokyo-night";
                            autocompleteMaxVisible = 20;
                        };
                        keybindings = builtins.fromJSON (builtins.readFile ./keybindings.json);
                    };
                };

            packages = eachSystem (
                system:
                let
                    pkgs = pkgsFor system;
                in
                {
                    default = pkgs.writeShellApplication {
                        name = "pi-session-tracker";
                        runtimeInputs = [ pkgs.tmux ];
                        text = ''
                            exec ${pkgs.nodejs_22}/bin/node --disable-warning=ExperimentalWarning \
                                ${./.}/src/infra/session-tracker/cli.ts "$@"
                        '';
                    };
                }
            );

            checks = eachSystem (
                system:
                let
                    pkgs = pkgsFor system;
                in
                {
                    pre-commit = pre-commit-hooks.lib.${system}.run {
                        src = ./.;
                        hooks = {
                            convco.enable = true;
                            nixfmt = {
                                enable = true;
                                entry = "${pkgs.nixfmt}/bin/nixfmt --indent=4";
                            };
                        };
                    };
                }
            );

            devShells = eachSystem (
                system:
                let
                    pkgs = pkgsFor system;
                    preCommitCheck = self.checks.${system}.pre-commit;
                    biomeArch = if pkgs.stdenv.hostPlatform.isAarch64 then "arm64" else "x64";
                    biomeBinary = pkgs.writeShellScript "biome-npm" ''
                        exec ${pkgs.stdenv.cc.bintools.dynamicLinker} \
                            "$PWD/node_modules/@biomejs/cli-linux-${biomeArch}/biome" "$@"
                    '';
                in
                {
                    default = pkgs.mkShell {
                        name = "pi-dev-config";
                        packages = [
                            pkgs.just
                            pkgs.nixfmt
                            pkgs.nodejs_22
                        ]
                        ++ preCommitCheck.enabledPackages;
                        BIOME_BINARY = biomeBinary;
                        inherit (preCommitCheck) shellHook;
                    };
                }
            );

            formatter = eachSystem (
                system:
                let
                    pkgs = pkgsFor system;
                in
                pkgs.writeShellScriptBin "nixfmt" ''exec ${pkgs.nixfmt}/bin/nixfmt --indent=4 "$@"''
            );
        };
}
