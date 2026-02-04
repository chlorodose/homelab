make:
    choom -n 1000 -- podman build --cap-add=all -t "homelab" .
