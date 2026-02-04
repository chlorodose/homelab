FROM docker.io/gentoo/stage3:systemd

COPY --chown=root:root etc/tmpfiles.d /etc/tmpfiles.d
RUN systemd-tmpfiles --boot --create --graceful

# Choose profile
RUN --mount=type=cache,id=cache,target=/var/cache emerge-webrsync && getuto
RUN --mount=type=cache,id=cache,target=/var/cache eselect profile set 'default/linux/amd64/23.0/systemd'

COPY --chown=root:root etc/portage /etc/portage
COPY --chown=root:root usr/local/portage /usr/local/portage
RUN --mount=type=cache,id=cache,target=/var/cache \
    USE="-verify-sig" emerge --oneshot --buildpkg --usepkg app-crypt/minisign && \
    emerge --oneshot --buildpkg --usepkg sys-kernel/kernel-server
RUN --mount=type=cache,id=cache,target=/var/cache \
    emerge --update --deep --newuse --buildpkg --usepkg --emptytree --noconfmem @world && \
    emerge --depclean --with-bdeps n

# Update local
# RUN locale-gen
RUN kver=$(ls /usr/lib/modules) && DRACUT_NO_XATTR=1 dracut -f /usr/lib/modules/$kver/initramfs.img "$kver"

COPY --chown=root:root etc /etc
COPY --chown=root:root usr /usr

# Clean users
RUN rm /etc/{passwd,group,shadow,gshadow} && touch /etc/{passwd,group,shadow,gshadow} && systemd-sysusers
# Clean files
RUN rm -rf /var/log/* /boot/* /boot/.*
# Clean services
RUN systemctl enable systemd-networkd.service sshd.service pppd-wan.service nftables.service vpnd-ladder.service \
    var.mount fix-root-sectx.service sshd.service

# Check orphan files
RUN find / -xdev \( -nouser -o -nogroup \) -print | tee /tmp/.result && \
    [ -s /tmp/.result ] && exit 1 || rm /tmp/.result
# Check lint
RUN bootc container lint --fatal-warnings
RUN rm -rf /var/* /tmp/*

# Label image
LABEL containers.bootc 1
LABEL ostree.bootable 1
CMD ["/sbin/init"]
