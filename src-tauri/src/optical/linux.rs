//! Linux drive I/O for optical discs, with the same shape as the Windows layer (`win.rs`): which
//! drives exist (`/dev/sr0`… shown as drive "0"…), whether a disc is in, its volume details, the CD
//! table of contents (in the same byte layout the Windows call returns, so `cd::parse_toc` reads
//! both) and CD-Text, raw CD audio sectors, the DVD copyright descriptor (to *detect* CSS, never to
//! work around it, D-007), and eject. All unsafe code of the optical module on Linux is here.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;

// From linux/cdrom.h and scsi/sg.h.
const CDROMREADTOCHDR: libc::c_ulong = 0x5305;
const CDROMREADTOCENTRY: libc::c_ulong = 0x5306;
const CDROMEJECT: libc::c_ulong = 0x5309;
const CDROMREADAUDIO: libc::c_ulong = 0x530e;
const CDROM_DRIVE_STATUS: libc::c_ulong = 0x5326;
const DVD_READ_STRUCT: libc::c_ulong = 0x5390;
const SG_IO: libc::c_ulong = 0x2285;
const CDSL_CURRENT: libc::c_int = libc::c_int::MAX;
const CDS_DISC_OK: libc::c_int = 4;
const CDROM_LBA: u8 = 0x01;
const CDROM_MSF: u8 = 0x02;
const CDROM_LEADOUT: u8 = 0xAA;
const DVD_STRUCT_COPYRIGHT: u8 = 0x01;
const SG_DXFER_FROM_DEV: libc::c_int = -3;
/// Bytes in one raw CD audio sector: 1/75 of a second of 16-bit stereo at 44.1 kHz.
pub const SECTOR: usize = 2352;

fn device_path(letter: char) -> PathBuf {
    PathBuf::from(format!("/dev/sr{letter}"))
}

/// The optical drives, as "0" for `/dev/sr0`, "1" for `/dev/sr1`…
pub fn optical_letters() -> Vec<char> {
    let mut found: Vec<char> = std::fs::read_dir("/sys/block")
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    let rest = name.strip_prefix("sr")?;
                    let mut chars = rest.chars();
                    let digit = chars.next().filter(|c| c.is_ascii_digit())?;
                    chars.next().is_none().then_some(digit)
                })
                .collect()
        })
        .unwrap_or_default();
    found.sort();
    found
}

/// Where the disc in a drive is mounted, mounting it through the desktop (udisks) when it isn't.
pub fn root(letter: char) -> PathBuf {
    let device = device_path(letter);
    let mounted = || -> Option<PathBuf> {
        let mounts = std::fs::read_to_string("/proc/mounts").ok()?;
        mounts.lines().find_map(|line| {
            let mut fields = line.split_whitespace();
            let source = fields.next()?;
            let target = fields.next()?;
            (std::fs::canonicalize(source).ok()? == std::fs::canonicalize(&device).ok()?).then(|| PathBuf::from(target.replace("\\040", " ")))
        })
    };
    if let Some(path) = mounted() {
        return path;
    }
    // Audio CDs have nothing to mount; this simply fails for them.
    let _ = std::process::Command::new("udisksctl")
        .args(["mount", "--no-user-interaction", "-b"])
        .arg(&device)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    mounted().unwrap_or_else(|| PathBuf::from("/nonexistent-disc"))
}

/// The volume name and a serial of the disc in a drive, from its ISO 9660 descriptor.
pub fn volume(letter: char) -> Option<(String, u32)> {
    let mut file = File::open(device_path(letter)).ok()?;
    file.seek(SeekFrom::Start(16 * 2048)).ok()?;
    let mut descriptor = [0u8; 2048];
    file.read_exact(&mut descriptor).ok()?;
    if &descriptor[1..6] != b"CD001" {
        return None;
    }
    let name = String::from_utf8_lossy(&descriptor[40..72]).trim().to_string();
    // The volume's creation date stands in for Windows' volume serial number.
    let hash = blake3::hash(&descriptor[813..830]);
    let serial = u32::from_le_bytes(hash.as_bytes()[..4].try_into().ok()?);
    Some((name, serial))
}

/// An open drive; closed when dropped.
pub struct Device {
    file: File,
    letter: char,
}

#[repr(C)]
#[derive(Default)]
struct TocHeader {
    first: u8,
    last: u8,
}

/// `struct cdrom_tocentry`: 12 bytes, its address union aligned to 4.
#[repr(C, align(4))]
#[derive(Default)]
struct TocEntry {
    track: u8,
    /// `cdte_adr:4` in the low bits, `cdte_ctrl:4` in the high bits.
    adr_ctrl: u8,
    format: u8,
    _pad: u8,
    /// `union cdrom_addr`: minute, second, frame (MSF) or an LBA.
    addr: [u8; 4],
    datamode: u8,
}

#[repr(C)]
struct ReadAudio {
    addr: i32,
    addr_format: u8,
    frames: libc::c_int,
    buffer: *mut u8,
}

#[repr(C)]
struct SgIoHeader {
    interface_id: libc::c_int,
    dxfer_direction: libc::c_int,
    cmd_len: u8,
    mx_sb_len: u8,
    iovec_count: u16,
    dxfer_len: u32,
    dxferp: *mut libc::c_void,
    cmdp: *const u8,
    sbp: *mut u8,
    timeout: u32,
    flags: u32,
    pack_id: libc::c_int,
    usr_ptr: *mut libc::c_void,
    status: u8,
    masked_status: u8,
    msg_status: u8,
    sb_len_wr: u8,
    host_status: u16,
    driver_status: u16,
    resid: libc::c_int,
    duration: u32,
    info: u32,
}

impl Device {
    pub fn open(letter: char) -> std::io::Result<Device> {
        // O_NONBLOCK opens a drive even with no disc in it.
        let file = std::fs::OpenOptions::new().read(true).custom_flags(libc::O_NONBLOCK).open(device_path(letter))?;
        Ok(Device { file, letter })
    }

    fn ioctl<T>(&self, request: libc::c_ulong, argument: *mut T) -> std::io::Result<libc::c_int> {
        let result = unsafe { libc::ioctl(self.file.as_raw_fd(), request as _, argument) };
        if result < 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(result)
    }

    /// Whether a disc is in the drive.
    pub fn has_media(&self) -> bool {
        let result = unsafe { libc::ioctl(self.file.as_raw_fd(), CDROM_DRIVE_STATUS as _, CDSL_CURRENT) };
        result == CDS_DISC_OK
    }

    /// The drive's vendor and model, as the kernel reports them.
    pub fn product(&self) -> Option<String> {
        let base = PathBuf::from(format!("/sys/block/sr{}/device", self.letter));
        let read = |name: &str| std::fs::read_to_string(base.join(name)).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let parts: Vec<String> = [read("vendor"), read("model")].into_iter().flatten().collect();
        (!parts.is_empty()).then(|| parts.join(" "))
    }

    /// The table of contents of an audio or mixed CD, laid out like Windows' CDROM_TOC: a 4-byte
    /// header (length, first and last track), then 8 bytes per track and the lead-out (control in
    /// the low nibble and ADR in the high one, track number, and the MSF address in bytes 5 to 7).
    pub fn read_toc(&self) -> std::io::Result<Vec<u8>> {
        let mut header = TocHeader::default();
        self.ioctl(CDROMREADTOCHDR, &mut header)?;
        let mut out = vec![0u8, 0, header.first, header.last];
        let tracks = (header.first..=header.last).chain(std::iter::once(CDROM_LEADOUT));
        for track in tracks {
            let mut entry = TocEntry { track, format: CDROM_MSF, ..Default::default() };
            self.ioctl(CDROMREADTOCENTRY, &mut entry)?;
            let adr = entry.adr_ctrl & 0x0F;
            let ctrl = entry.adr_ctrl >> 4;
            out.extend_from_slice(&[0, ctrl | (adr << 4), track, 0, 0, entry.addr[0], entry.addr[1], entry.addr[2]]);
        }
        let length = (out.len() - 2) as u16;
        out[..2].copy_from_slice(&length.to_be_bytes());
        Ok(out)
    }

    /// The raw CD-Text packs (READ TOC/PMA/ATIP, format 5, through SG_IO), if the disc has any;
    /// the same bytes Windows returns.
    pub fn read_cd_text(&self) -> Option<Vec<u8>> {
        let mut out = vec![0u8; 4 + 18 * 256 * 8];
        let length = out.len() as u16;
        let command: [u8; 10] = [0x43, 0x00, 0x05, 0, 0, 0, 0, (length >> 8) as u8, length as u8, 0];
        let mut sense = [0u8; 32];
        let mut io = SgIoHeader {
            interface_id: 'S' as libc::c_int,
            dxfer_direction: SG_DXFER_FROM_DEV,
            cmd_len: command.len() as u8,
            mx_sb_len: sense.len() as u8,
            iovec_count: 0,
            dxfer_len: out.len() as u32,
            dxferp: out.as_mut_ptr() as *mut libc::c_void,
            cmdp: command.as_ptr(),
            sbp: sense.as_mut_ptr(),
            timeout: 10_000,
            flags: 0,
            pack_id: 0,
            usr_ptr: std::ptr::null_mut(),
            status: 0,
            masked_status: 0,
            msg_status: 0,
            sb_len_wr: 0,
            host_status: 0,
            driver_status: 0,
            resid: 0,
            duration: 0,
            info: 0,
        };
        self.ioctl(SG_IO, &mut io).ok()?;
        if io.status != 0 || io.host_status != 0 || io.driver_status != 0 {
            return None;
        }
        let n = (u16::from_be_bytes([out[0], out[1]]) as usize + 2).min(out.len());
        out.truncate(n);
        (n > 4).then_some(out)
    }

    /// Raw audio sectors starting at `lba`.
    pub fn read_audio(&self, lba: u32, count: u32) -> std::io::Result<Vec<u8>> {
        let mut out = vec![0u8; SECTOR * count as usize];
        let mut request = ReadAudio { addr: lba as i32, addr_format: CDROM_LBA, frames: count as libc::c_int, buffer: out.as_mut_ptr() };
        self.ioctl(CDROMREADAUDIO, &mut request)?;
        Ok(out)
    }

    /// The DVD copyright descriptor's protection type: 0 none, otherwise CSS/CPPM. Only read to
    /// refuse protected discs (D-007).
    pub fn dvd_protection(&self) -> Option<u8> {
        // `union dvd_struct` with its `dvd_copyright` member: type, layer number, cpst, rmi.
        let mut buffer = vec![0u8; 4096];
        buffer[0] = DVD_STRUCT_COPYRIGHT;
        self.ioctl(DVD_READ_STRUCT, buffer.as_mut_ptr()).ok()?;
        Some(buffer[2])
    }

    pub fn eject(&self) -> std::io::Result<()> {
        // A mounted disc is let go of first.
        let _ = std::process::Command::new("udisksctl")
            .args(["unmount", "--no-user-interaction", "-b"])
            .arg(device_path(self.letter))
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        let result = unsafe { libc::ioctl(self.file.as_raw_fd(), CDROMEJECT as _, 0) };
        if result < 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }
}
