//! Windows drive I/O for optical discs: which drives exist, whether a disc is in, its volume
//! details, the CD table of contents and CD-Text, raw CD audio sectors, the DVD copyright
//! descriptor (to *detect* CSS, never to work around it, D-007), and eject.
//! All unsafe code of the optical module is here.

use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;

use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_READ, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows_sys::Win32::System::IO::DeviceIoControl;

const DRIVE_CDROM: u32 = 5;
// CTL_CODE values from ntddcdrm.h, ntddstor.h and ntddcdvd.h.
const IOCTL_CDROM_READ_TOC: u32 = 0x0002_4000;
const IOCTL_CDROM_READ_TOC_EX: u32 = 0x0002_4054;
const IOCTL_CDROM_RAW_READ: u32 = 0x0002_403E;
const IOCTL_STORAGE_CHECK_VERIFY2: u32 = 0x002D_0800;
const IOCTL_STORAGE_EJECT_MEDIA: u32 = 0x002D_4808;
const IOCTL_STORAGE_QUERY_PROPERTY: u32 = 0x002D_1400;
const IOCTL_DVD_READ_STRUCTURE: u32 = 0x0033_5140;
const CDROM_READ_TOC_EX_FORMAT_CDTEXT: u8 = 5;
const CDDA: u32 = 2;
/// Bytes in one raw CD audio sector: 1/75 of a second of 16-bit stereo at 44.1 kHz.
pub const SECTOR: usize = 2352;

fn wide(text: &str) -> Vec<u16> {
    std::ffi::OsStr::new(text).encode_wide().chain(std::iter::once(0)).collect()
}

/// Letters of the optical drives, in order.
pub fn optical_letters() -> Vec<char> {
    let mask = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|bit| mask & (1 << bit) != 0)
        .map(|bit| (b'A' + bit) as char)
        .filter(|letter| unsafe { GetDriveTypeW(wide(&format!("{letter}:\\")).as_ptr()) } == DRIVE_CDROM)
        .collect()
}

/// The volume name and serial number of the disc in a drive, when it has a file system.
pub fn volume(letter: char) -> Option<(String, u32)> {
    let mut name = [0u16; 261];
    let mut serial = 0u32;
    let ok = unsafe {
        GetVolumeInformationW(
            wide(&format!("{letter}:\\")).as_ptr(),
            name.as_mut_ptr(),
            name.len() as u32,
            &mut serial,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
        )
    };
    if ok == 0 {
        return None;
    }
    let end = name.iter().position(|&c| c == 0).unwrap_or(name.len());
    Some((String::from_utf16_lossy(&name[..end]), serial))
}

/// An open drive; closed when dropped.
pub struct Device(HANDLE);

impl Drop for Device {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

// The handle is only used by one thread at a time (each job opens its own).
unsafe impl Send for Device {}

impl Device {
    pub fn open(letter: char) -> std::io::Result<Device> {
        let handle = unsafe {
            CreateFileW(
                wide(&format!(r"\\.\{letter}:")).as_ptr(),
                GENERIC_READ,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error());
        }
        Ok(Device(handle))
    }

    fn control(&self, code: u32, input: &[u8], output: &mut [u8]) -> std::io::Result<usize> {
        let mut returned = 0u32;
        let ok = unsafe {
            DeviceIoControl(
                self.0,
                code,
                if input.is_empty() { std::ptr::null() } else { input.as_ptr() as *const c_void },
                input.len() as u32,
                if output.is_empty() { std::ptr::null_mut() } else { output.as_mut_ptr() as *mut c_void },
                output.len() as u32,
                &mut returned,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(returned as usize)
    }

    /// Whether a disc is in the drive.
    pub fn has_media(&self) -> bool {
        self.control(IOCTL_STORAGE_CHECK_VERIFY2, &[], &mut []).is_ok()
    }

    /// The drive's vendor and product, as Windows reports them.
    pub fn product(&self) -> Option<String> {
        // STORAGE_PROPERTY_QUERY: PropertyId = StorageDeviceProperty (0), QueryType = PropertyStandardQuery (0).
        let query = [0u8; 12];
        let mut out = vec![0u8; 1024];
        let n = self.control(IOCTL_STORAGE_QUERY_PROPERTY, &query, &mut out).ok()?;
        let text = |offset_at: usize| -> Option<String> {
            let offset = u32::from_le_bytes(out.get(offset_at..offset_at + 4)?.try_into().ok()?) as usize;
            if offset == 0 || offset >= n {
                return None;
            }
            let end = out[offset..n].iter().position(|&b| b == 0).map_or(n, |p| offset + p);
            let value = String::from_utf8_lossy(&out[offset..end]).trim().to_string();
            (!value.is_empty()).then_some(value)
        };
        // STORAGE_DEVICE_DESCRIPTOR: VendorIdOffset at 12, ProductIdOffset at 16.
        let parts: Vec<String> = [text(12), text(16)].into_iter().flatten().collect();
        (!parts.is_empty()).then(|| parts.join(" "))
    }

    /// The raw CDROM_TOC (table of contents) of an audio or mixed CD.
    pub fn read_toc(&self) -> std::io::Result<Vec<u8>> {
        let mut out = vec![0u8; 804];
        let n = self.control(IOCTL_CDROM_READ_TOC, &[], &mut out)?;
        out.truncate(n);
        Ok(out)
    }

    /// The raw CD-Text packs, if the disc has any.
    pub fn read_cd_text(&self) -> Option<Vec<u8>> {
        // CDROM_READ_TOC_EX: Format (4 bits) | Reserved | Msf (1 bit), SessionTrack, Reserved2[2].
        let input = [CDROM_READ_TOC_EX_FORMAT_CDTEXT, 0, 0, 0];
        let mut out = vec![0u8; 4 + 18 * 256 * 8];
        let n = self.control(IOCTL_CDROM_READ_TOC_EX, &input, &mut out).ok()?;
        out.truncate(n);
        (n > 4).then_some(out)
    }

    /// Raw audio sectors starting at `lba`; at most about 26 per call.
    pub fn read_audio(&self, lba: u32, count: u32) -> std::io::Result<Vec<u8>> {
        // RAW_READ_INFO: DiskOffset (LARGE_INTEGER, in 2048-byte units), SectorCount, TrackMode.
        let mut input = [0u8; 16];
        input[..8].copy_from_slice(&(lba as i64 * 2048).to_le_bytes());
        input[8..12].copy_from_slice(&count.to_le_bytes());
        input[12..16].copy_from_slice(&CDDA.to_le_bytes());
        let mut out = vec![0u8; SECTOR * count as usize];
        let n = self.control(IOCTL_CDROM_RAW_READ, &input, &mut out)?;
        out.truncate(n);
        Ok(out)
    }

    /// The DVD copyright descriptor's protection type: 0 none, otherwise CSS/CPPM. Only read to
    /// refuse protected discs (D-007).
    pub fn dvd_protection(&self) -> Option<u8> {
        // DVD_READ_STRUCTURE: BlockByteOffset (8), Format = DvdCopyrightDescriptor (1), SessionId, LayerNumber; padded to 24.
        let mut input = [0u8; 24];
        input[8..12].copy_from_slice(&1u32.to_le_bytes());
        let mut out = [0u8; 8];
        self.control(IOCTL_DVD_READ_STRUCTURE, &input, &mut out).ok()?;
        // DVD_DESCRIPTOR_HEADER (4 bytes), then CopyrightProtectionType.
        Some(out[4])
    }

    pub fn eject(&self) -> std::io::Result<()> {
        self.control(IOCTL_STORAGE_EJECT_MEDIA, &[], &mut []).map(|_| ())
    }
}
