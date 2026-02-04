# Build basic rootfs
FROM quay.io/fedora/fedora-bootc:43 as rootfs-provider
RUN /usr/libexec/bootc-base-imagectl build-rootfs --manifest=minimal --no-initramfs --sysuser --install dnf5-plugins /rootfs


# Start build
FROM scratch
COPY --from=rootfs-provider /rootfs/ /

# Configure dnf
RUN dnf copr enable -y chlorodose/kernel && \
    dnf makecache

# Install packages
RUN dnf install -y selinux-policy policycoreutils
RUN dnf install -y \
    coreutils zip cpio curl wget diffutils findutils gawk grep jq sed gzip xz zstd tar file which less \
    bind-utils elfutils e2fsprogs gnupg2 iproute socat attr quota openssl bcachefs-tools xfsprogs
RUN dnf install -y util-linux dmidecode efibootmgr ethtool tpm2-tools numactl
RUN dnf install -y sudo pinentry pam openssh
RUN dnf install -y nano nano-default-editor audit
RUN dnf install -y bootc podman toolbox
RUN dnf install -y systemd-boot bootupd
RUN dnf install -y systemd-oomd-defaults systemd-sysusers systemd-pam
RUN dnf install -y systemd-resolved systemd-networkd systemd-networkd-defaults ppp rp-pppoe openconnect tunctl nftables
RUN dnf remove -y kernel kernel-core kernel-module kernel-modules-core
RUN rm -rf /usr/lib/modules/* /lib/modules/*
RUN dnf install -y kernel-cachyos-server kernel-cachyos-server-nvidia-open
RUN set -xe; kver=$(ls /usr/lib/modules); env DRACUT_NO_XATTR=1 dracut -vf /usr/lib/modules/$kver/initramfs.img "$kver"
RUN rm -rf /boot/*
RUN dnf autoremove -y
RUN dnf clean all && \
    rm -rf /var/lib/dnf /var/log/dnf*.log* /var/cache/libdnf5 /var/lib/rpm-state/* /var/cache/ldconfig/aux-cache


# Install config
COPY --chown=root:root etc /tmp/etc
COPY --chown=root:root usr /tmp/usr
WORKDIR /tmp
RUN \
    find usr -type d -exec mkdir -p /{} \; && \
    find etc -type d -exec mkdir -p /{} \; && \
    find usr -type f -exec cp -a {} /{} \; -exec setfattr -n user.component -v patch /{} \; && \
    find etc -type f -exec cp -a {} /{} \; -exec setfattr -n user.component -v config /{} \;

# Check errors
RUN bootc container lint --fatal-warnings
RUN rm -rf /var/*

# Label image
LABEL containers.bootc 1
LABEL ostree.bootable 1
CMD ["/sbin/init"]
