# Gitops repo for my homelab k8s cluster

## Checking for updates

`scripts/check-updates.py` walks every Flux Helm declaration (`HelmRepository` / `HelmChart` / `OCIRepository` / `HelmRelease`) and every container image reference in the repo, then queries upstream for newer versions.

```sh
scripts/check-updates.py --outdated        # only show entries with updates or problems
scripts/check-updates.py --images --json   # machine-readable, images only
```

Requires `uv` (dependencies are declared inline) and, optionally, `helm` to fill in image defaults omitted from `HelmRelease` values.
