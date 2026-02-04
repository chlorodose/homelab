# Copyright 1999-2026 Gentoo Authors
# Distributed under the terms of the GNU General Public License v2
EAPI=8
inherit unpacker
inherit kernel-build
DESCRIPTION="Custom linux kernel for server"
HOMEPAGE="https://example.org"
IUSE="debug secureboot"

L_KVER="${PV}"
S_KVER="6.18"
KPHVER="87a5bb45dfee4cf31a57472591cb5013a7e9afcf"
KFGVER="661da6f123bf3984e462fe9f932a38e643d6e081"
GFGVER="g18"
BFSVER="1.36.1"
NVIVER="590.48.01"
SRC_URI="
    https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-${L_KVER}.tar.xz
    https://evilpiepirate.org/bcachefs-tools/bcachefs-tools-${BFSVER}.tar.zst
    https://github.com/CachyOS/kernel-patches/archive/${KPHVER}.zip
    https://github.com/CachyOS/linux-cachyos/archive/${KFGVER}.zip
    https://github.com/NVIDIA/open-gpu-kernel-modules/archive/refs/tags/${NVIVER}.tar.gz
    https://github.com/projg2/gentoo-kernel-config/archive/${GFGVER}.tar.gz -> gentoo-kernel-config-${GFGVER}.tar.gz
"
S="${WORKDIR}/linux-${PV}"
LICENSE="Apache-2.0 MIT"
SLOT="0"
KEYWORDS="amd64"
BDEPEND="
	app-arch/zstd
	sys-apps/sed
"

src_unpack() {
	unpacker_src_unpack
}

src_prepare() {
    default
    eapply "${WORKDIR}/kernel-patches-${KPHVER}/${S_KVER}/all/0001-cachyos-base-all.patch"
    rm -rf fs/bcachefs || die
    cp -r ${WORKDIR}/bcachefs-tools-${BFSVER}/libbcachefs fs/bcachefs || die
    if ! grep -q "fs/bcachefs/Kconfig" "fs/Kconfig"; then
        sed -i '/source "fs\/btrfs\/Kconfig"/a source "fs/bcachefs/Kconfig"' "fs/Kconfig" || die
    fi
    if ! grep -q "bcachefs/" "fs/Makefile"; then
        sed -i '/obj-$(CONFIG_BTRFS_FS).*+= btrfs\//a obj-$(CONFIG_BCACHEFS_FS) += bcachefs/' "fs/Makefile" || die
    fi
    pushd "${WORKDIR}/open-gpu-kernel-modules-${NVIVER}/kernel-open" || die
    eapply "${WORKDIR}/kernel-patches-${KPHVER}/${S_KVER}/misc/nvidia/0001-Enable-atomic-kernel-modesetting-by-default.patch"
    popd || die
}

src_configure() {
    scripts/config -e CACHY || die
    scripts/config -d PREEMPT_DYNAMIC -d PREEMPT -e PREEMPT_VOLUNTARY -d PREEMPT_LAZY -d PREEMPT_NONE || die
    scripts/config -e BCACHEFS_FS -e BCACHEFS_QUOTA -e BCACHEFS_ERASURE_CODING -e BCACHEFS_SIX_OPTIMISTIC_SPIN || die
    scripts/config --set-str CONFIG_LOCALVERSION "-server" || die
    scripts/config --set-str CONFIG_DEFAULT_HOSTNAME "server" || die
    scripts/config --set-val X86_64_VERSION 4 || die
    scripts/config -e HZ_1000 --set-val HZ 300 || die
    scripts/config -e CONFIG_DEBUG_INFO_BTF || die

    mv .config custom.config || die
    touch .config || die

    local merge_configs=("${WORKDIR}/linux-cachyos-${KFGVER}/linux-cachyos-server/config")
    use secureboot && merge_configs+=("${WORKDIR}/gentoo-kernel-config-${GFGVER}/secureboot.config")
    kernel-build_merge_configs "${merge_configs[@]}" "${PWD}/custom.config"

    kernel-build_src_configure
}

src_compile() {
    kernel-build_src_compile

    cp "${WORKDIR}"/build/Module.symvers . || die
    local KSRC=${S}
    local ARCHARG=""
    use amd64 && ARCHARG="ARCH=x86_64"
    pushd "${WORKDIR}/open-gpu-kernel-modules-${NVIVER}" || die
    emake IGNORE_CC_MISMATCH=yes KERNEL_UNAME=${L_KVER}-server SYSSRC=${KSRC} "${MAKEARGS[@]}" HOSTLDFLAGS= LDFLAGS= ${ARCHARG} SYSOUT="${WORKDIR}"/build modules
    popd || die
}

src_install() {
    export ZSTD_CLEVEL=19
    local KSRC=${S}
    local ARCHARG=""
    use amd64 && ARCHARG="ARCH=x86_64"
    pushd "${WORKDIR}/open-gpu-kernel-modules-${NVIVER}" || die
    emake IGNORE_CC_MISMATCH=yes KERNEL_UNAME=${L_KVER}-server SYSSRC=${KSRC} "${MAKEARGS[@]}" HOSTLDFLAGS= LDFLAGS= ${ARCHARG} SYSOUT="${WORKDIR}"/build INSTALL_PATH="${ED}/boot" INSTALL_MOD_PATH="${ED}" INSTALL_MOD_STRIP="${strip_args}" INSTALL_DTBS_PATH="${ED}/lib/modules/${L_KVER}-server/dtb" modules_install
    popd || die

    kernel-build_src_install
}
