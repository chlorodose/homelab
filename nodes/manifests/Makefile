
.PHONY: default
default: talosconfig talos.yaml

talos.yaml:
	talosctl gen secrets --force -o /dev/stdout | yq '.' | \
        yq -n '. = load("talos.template.yaml") | .stringData."secrets.yaml" = strload("/dev/stdin")' >talos.yaml
talosconfig: talos.yaml
	[ -n "${CLUSTER}" ]
	[ -n "${ENDPOINT}" ]
	yq -r '.stringData."secrets.yaml"' talos.yaml | \
		talosctl gen config --with-secrets /dev/stdin -t talosconfig -o /dev/stdout --force "${CLUSTER}" "${ENDPOINT}" >talosconfig
