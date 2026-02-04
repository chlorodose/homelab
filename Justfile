make:
    podman build --cap-add=all --device /dev/fuse -t "homelab" .
