# Copyright 1999-2026 Gentoo Authors
# Distributed under the terms of the GNU General Public License v2
EAPI=8
inherit cargo
inherit unpacker
DESCRIPTION="Boot and upgrade via container images"
HOMEPAGE="https://bootc-dev.github.io/"
SRC_URI="
	https://github.com/bootc-dev/bootc/archive/refs/tags/v${PV}.tar.gz
	https://github.com/bootc-dev/bootc/releases/download/v${PV}/${P}-vendor.tar.zstd
"
S="${WORKDIR}/${P}"
LICENSE="Apache-2.0 MIT"
SLOT="0"
KEYWORDS="amd64"
RDEPEND="
	dev-util/ostree
	sys-kernel/dracut
	sys-apps/systemd
	app-arch/zstd
	app-containers/skopeo
	app-containers/podman
	sys-apps/util-linux
"
DEPEND="${RDEPEND}"
BDEPEND="
	dev-lang/rust
	virtual/pkgconfig
"

src_unpack() {
	unpacker_src_unpack
	mv "${WORKDIR}/vendor" "${S}/" || die "Unable to move vendor folder"
}

src_configure() {
	ECARGO_VENDOR="${S}/vendor"
    cargo_gen_config
    echo '[source."git+https://github.com/containers/composefs-rs?rev=e9008489375044022e90d26656960725a76f4620"]' >>${ECARGO_HOME}/config.toml
    echo 'git = "https://github.com/containers/composefs-rs"' >>${ECARGO_HOME}/config.toml
    echo 'rev = "e9008489375044022e90d26656960725a76f4620"' >>${ECARGO_HOME}/config.toml
    echo 'replace-with = "gentoo"' >>${ECARGO_HOME}/config.toml
	cargo_src_configure --bins
}

src_compile() {
	cargo_src_compile
}

src_install() {
	emake DESTDIR="${D}" install-all
}
