use std::sync::Once;

use serde::Serialize;
use windows::core::{factory, Interface, IInspectable};
use windows::Win32::Foundation::{HMODULE, HWND, LPARAM, POINT, RECT, TRUE};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ, D3D11_MAPPED_SUBRESOURCE,
    D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_MODE_DESC, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput, IDXGIOutput1, IDXGIOutputDuplication, IDXGIResource,
    DXGI_ENUM_MODES, DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO, DXGI_OUTDUPL_POINTER_SHAPE_INFO,
    DXGI_OUTPUT_DESC,
};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Graphics::Direct3D11::D3D11_CREATE_DEVICE_BGRA_SUPPORT;
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible, GA_ROOT,
};
use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;

#[derive(Clone, Debug, Serialize)]
pub struct SourceInfo {
    pub id: String,
    pub kind: String,
    pub label: String,
}

pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

pub enum Capturer {
    Display(DisplayCapturer),
    Window(WindowCapturer),
}

impl Capturer {
    pub fn open(id: &str) -> Result<Self, String> {
        ensure_winrt();
        if let Some(rest) = id.strip_prefix("display:") {
            let mut parts = rest.split(':');
            let adapter: u32 = parts.next().unwrap_or("0").parse().map_err(|_| "Choose a screen to share.".to_owned())?;
            let output: u32 = parts.next().unwrap_or("0").parse().map_err(|_| "Choose a screen to share.".to_owned())?;
            return Ok(Self::Display(DisplayCapturer::open(adapter, output)?));
        }
        if let Some(rest) = id.strip_prefix("window:") {
            let value: u64 = rest.parse().map_err(|_| "Choose a screen to share.".to_owned())?;
            return Ok(Self::Window(WindowCapturer::open(HWND(value as *mut std::ffi::c_void))?));
        }
        Err("Choose a screen to share.".into())
    }

    pub fn refresh_rate(&self) -> u32 {
        match self {
            Self::Display(display) => display.refresh.max(15),
            Self::Window(_) => 60,
        }
    }

    pub fn acquire(&mut self, timeout_ms: u32) -> Result<Option<Frame>, String> {
        match self {
            Self::Display(display) => display.acquire(timeout_ms),
            Self::Window(window) => window.acquire(),
        }
    }
}

pub fn list_sources() -> Result<Vec<SourceInfo>, String> {
    ensure_winrt();
    let mut sources = list_displays()?;
    sources.extend(list_windows());
    Ok(sources)
}

pub(crate) struct DisplayCapturer {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    duplication: IDXGIOutputDuplication,
    origin: POINT,
    refresh: u32,
    staging: Option<ID3D11Texture2D>,
    pointer: Vec<u8>,
}

impl DisplayCapturer {
    fn open(adapter_index: u32, output_index: u32) -> Result<Self, String> {
        let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1() }.map_err(win_err)?;
        let adapter: IDXGIAdapter1 = unsafe { factory.EnumAdapters1(adapter_index) }.map_err(|_| "That display is no longer available.".to_owned())?;
        let output: IDXGIOutput = unsafe { adapter.EnumOutputs(output_index) }.map_err(|_| "That display is no longer available.".to_owned())?;
        let desc = unsafe { output.GetDesc() }.map_err(win_err)?;
        let output1: IDXGIOutput1 = output.cast().map_err(win_err)?;
        let (device, context) = device_on(&adapter)?;
        let duplication = unsafe { output1.DuplicateOutput(&device) }.map_err(|_| "Could not capture that screen.".to_owned())?;
        Ok(Self {
            device,
            context,
            duplication,
            origin: POINT { x: desc.DesktopCoordinates.left, y: desc.DesktopCoordinates.top },
            refresh: refresh_of(&output1).unwrap_or(60),
            staging: None,
            pointer: Vec::new(),
        })
    }

    fn acquire(&mut self, timeout_ms: u32) -> Result<Option<Frame>, String> {
        let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut resource: Option<IDXGIResource> = None;
        let acquired = unsafe { self.duplication.AcquireNextFrame(timeout_ms, &mut info, &mut resource) };
        if let Err(error) = acquired {
            if error.code() == DXGI_ERROR_WAIT_TIMEOUT {
                return Ok(None);
            }
            if error.code() == DXGI_ERROR_ACCESS_LOST {
                return Err("lost".into());
            }
            return Err(win_err(error));
        }
        let result = self.copy_frame(&info, resource);
        unsafe { self.duplication.ReleaseFrame() }.ok();
        result
    }

    fn copy_frame(&mut self, info: &DXGI_OUTDUPL_FRAME_INFO, resource: Option<IDXGIResource>) -> Result<Option<Frame>, String> {
        let Some(resource) = resource else { return Ok(None) };
        let texture: ID3D11Texture2D = resource.cast().map_err(win_err)?;
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        unsafe { texture.GetDesc(&mut desc) };
        if self.staging.is_none() {
            let mut staging_desc = desc;
            staging_desc.Usage = D3D11_USAGE_STAGING;
            staging_desc.BindFlags = 0;
            staging_desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
            staging_desc.MiscFlags = 0;
            let mut created = None;
            unsafe { self.device.CreateTexture2D(&staging_desc, None, Some(&mut created)) }.map_err(win_err)?;
            self.staging = created;
        }
        let staging = self.staging.as_ref().unwrap();
        unsafe { self.context.CopyResource(staging, &texture) };
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        unsafe { self.context.Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)) }.map_err(win_err)?;
        let width = desc.Width;
        let height = desc.Height;
        let stride = mapped.RowPitch as usize;
        let mut bgra = vec![0u8; width as usize * height as usize * 4];
        for row in 0..height as usize {
            let source = unsafe { std::slice::from_raw_parts(mapped.pData.cast::<u8>().add(row * stride), width as usize * 4) };
            bgra[row * width as usize * 4..(row + 1) * width as usize * 4].copy_from_slice(source);
        }
        unsafe { self.context.Unmap(staging, 0) };
        self.blend_pointer(info, &mut bgra, width, height);
        Ok(Some(Frame { width, height, bgra }))
    }

    fn blend_pointer(&mut self, info: &DXGI_OUTDUPL_FRAME_INFO, bgra: &mut [u8], width: u32, height: u32) {
        if !info.PointerPosition.Visible.as_bool() {
            return;
        }
        let mut required = 0u32;
        let mut shape = DXGI_OUTDUPL_POINTER_SHAPE_INFO::default();
        if unsafe { self.duplication.GetFramePointerShape(0, std::ptr::null_mut(), &mut required, &mut shape) }.is_err() && required > 0 {
            self.pointer.resize(required as usize, 0);
            if unsafe {
                self.duplication.GetFramePointerShape(required, self.pointer.as_mut_ptr().cast(), &mut required, &mut shape)
            }
            .is_err()
            {
                return;
            }
        }
        if shape.Width == 0 || shape.Height == 0 || self.pointer.is_empty() {
            return;
        }
        let left = info.PointerPosition.Position.x - self.origin.x - shape.HotSpot.x;
        let top = info.PointerPosition.Position.y - self.origin.y - shape.HotSpot.y;
        if shape.Type == 1 {
            blend_color_pointer(bgra, width, height, left, top, &self.pointer, shape.Width, shape.Height, shape.Pitch);
        }
    }
}

pub(crate) struct WindowCapturer {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    staging: Option<ID3D11Texture2D>,
}

impl WindowCapturer {
    fn open(hwnd: HWND) -> Result<Self, String> {
        if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
            return Err("That window is no longer available.".into());
        }
        let (device, context) = device_on_default()?;
        let item = capture_item(hwnd)?;
        let size = item.Size().map_err(|_| "That window has no picture yet.".to_owned())?;
        if size.Width < 2 || size.Height < 2 {
            return Err("That window has no picture yet.".into());
        }
        let direct = direct3d_device(&device)?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&direct, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size)
            .map_err(|_| "Could not capture that window.".to_owned())?;
        let session = pool.CreateCaptureSession(&item).map_err(|_| "Could not capture that window.".to_owned())?;
        session.StartCapture().map_err(|_| "Could not capture that window.".to_owned())?;
        Ok(Self { device, context, pool, session, staging: None })
    }

    fn acquire(&mut self) -> Result<Option<Frame>, String> {
        let frame = match self.pool.TryGetNextFrame() {
            Ok(frame) => frame,
            Err(_) => return Ok(None),
        };
        let surface = frame.Surface().map_err(win_err)?;
        let access: IDirect3DDxgiInterfaceAccess = surface.cast().map_err(win_err)?;
        let texture: ID3D11Texture2D = unsafe { access.GetInterface() }.map_err(win_err)?;
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        unsafe { texture.GetDesc(&mut desc) };
        let mut staging_desc = desc;
        staging_desc.Usage = D3D11_USAGE_STAGING;
        staging_desc.BindFlags = 0;
        staging_desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
        staging_desc.MiscFlags = 0;
        staging_desc.SampleDesc = DXGI_SAMPLE_DESC { Count: 1, Quality: 0 };
        let mut created = None;
        unsafe { self.device.CreateTexture2D(&staging_desc, None, Some(&mut created)) }.map_err(win_err)?;
        let staging = created.ok_or_else(|| "Could not capture that window.".to_owned())?;
        unsafe { self.context.CopyResource(&staging, &texture) };
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        unsafe { self.context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)) }.map_err(win_err)?;
        let width = desc.Width;
        let height = desc.Height;
        let stride = mapped.RowPitch as usize;
        let mut bgra = vec![0u8; width as usize * height as usize * 4];
        for row in 0..height as usize {
            let source = unsafe { std::slice::from_raw_parts(mapped.pData.cast::<u8>().add(row * stride), width as usize * 4) };
            bgra[row * width as usize * 4..(row + 1) * width as usize * 4].copy_from_slice(source);
        }
        unsafe { self.context.Unmap(&staging, 0) };
        self.staging = Some(staging);
        Ok(Some(Frame { width, height, bgra }))
    }
}

impl Drop for WindowCapturer {
    fn drop(&mut self) {
        self.session.Close().ok();
        self.pool.Close().ok();
    }
}

fn list_displays() -> Result<Vec<SourceInfo>, String> {
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1() }.map_err(win_err)?;
    let mut sources = Vec::new();
    let mut adapter_index = 0u32;
    let mut display_number = 1u32;
    loop {
        let adapter = match unsafe { factory.EnumAdapters1(adapter_index) } {
            Ok(adapter) => adapter,
            Err(_) => break,
        };
        let mut output_index = 0u32;
        loop {
            let output = match unsafe { adapter.EnumOutputs(output_index) } {
                Ok(output) => output,
                Err(_) => break,
            };
            let name = output_name(&output).unwrap_or_else(|| format!("Display {display_number}"));
            sources.push(SourceInfo {
                id: format!("display:{adapter_index}:{output_index}"),
                kind: "display".into(),
                label: name,
            });
            display_number += 1;
            output_index += 1;
        }
        adapter_index += 1;
    }
    Ok(sources)
}

fn list_windows() -> Vec<SourceInfo> {
    let mut sources = Vec::new();
    let pointer = &mut sources as *mut Vec<SourceInfo>;
    unsafe {
        let _ = EnumWindows(Some(enum_window), LPARAM(pointer as isize));
    }
    sources
}

unsafe extern "system" fn enum_window(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
    let sources = &mut *(lparam.0 as *mut Vec<SourceInfo>);
    if IsWindowVisible(hwnd).as_bool() && GetAncestor(hwnd, GA_ROOT) == hwnd {
        let mut cloaked = 0u32;
        let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, std::mem::size_of::<u32>() as u32);
        if cloaked == 0 {
            let length = GetWindowTextLengthW(hwnd);
            if length > 0 {
                let mut buffer = vec![0u16; length as usize + 1];
                let copied = GetWindowTextW(hwnd, &mut buffer);
                if copied > 0 {
                    let title = String::from_utf16_lossy(&buffer[..copied as usize]);
                    if title != "Share to the room" && title != "Smart Screen Share" {
                        sources.push(SourceInfo {
                            id: format!("window:{}", hwnd.0 as usize),
                            kind: "window".into(),
                            label: title,
                        });
                    }
                }
            }
        }
    }
    TRUE
}

fn device_on(adapter: &IDXGIAdapter1) -> Result<(ID3D11Device, ID3D11DeviceContext), String> {
    let mut device = None;
    let mut context = None;
    unsafe {
        D3D11CreateDevice(
            adapter,
            D3D_DRIVER_TYPE_UNKNOWN,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
    }
    .map_err(|_| "Could not capture that screen.".to_owned())?;
    Ok((device.unwrap(), context.unwrap()))
}

fn device_on_default() -> Result<(ID3D11Device, ID3D11DeviceContext), String> {
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
    let mut device = None;
    let mut context = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
    }
    .map_err(|_| "Could not capture that window.".to_owned())?;
    Ok((device.unwrap(), context.unwrap()))
}

fn direct3d_device(device: &ID3D11Device) -> Result<IDirect3DDevice, String> {
    let dxgi = device.cast::<windows::Win32::Graphics::Dxgi::IDXGIDevice>().map_err(win_err)?;
    let inspectable: IInspectable = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }.map_err(win_err)?;
    inspectable.cast().map_err(|_| "Could not capture that window.".to_owned())
}

fn capture_item(hwnd: HWND) -> Result<GraphicsCaptureItem, String> {
    let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().map_err(win_err)?;
    unsafe { interop.CreateForWindow(hwnd) }.map_err(|_| "Could not capture that window.".to_owned())
}

fn output_name(output: &IDXGIOutput) -> Option<String> {
    let desc: DXGI_OUTPUT_DESC = unsafe { output.GetDesc() }.ok()?;
    let name = String::from_utf16_lossy(trim_wide(&desc.DeviceName));
    if name.is_empty() { None } else { Some(name.replace(r"\\.\", "Display ")) }
}

fn refresh_of(output: &IDXGIOutput1) -> Option<u32> {
    let mut count = 0u32;
    unsafe { output.GetDisplayModeList(DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_ENUM_MODES(0), &mut count, None) }.ok()?;
    if count == 0 {
        return None;
    }
    let mut modes = vec![DXGI_MODE_DESC::default(); count as usize];
    unsafe {
        output.GetDisplayModeList(DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_ENUM_MODES(0), &mut count, Some(modes.as_mut_ptr()))
    }
    .ok()?;
    modes.truncate(count as usize);
    modes.last().map(|mode| {
        let denom = mode.RefreshRate.Denominator.max(1);
        (mode.RefreshRate.Numerator / denom).clamp(15, 240)
    })
}

fn trim_wide(value: &[u16]) -> &[u16] {
    let end = value.iter().position(|unit| *unit == 0).unwrap_or(value.len());
    &value[..end]
}

fn blend_color_pointer(bgra: &mut [u8], width: u32, height: u32, left: i32, top: i32, pointer: &[u8], pointer_width: u32, pointer_height: u32, pitch: u32) {
    for row in 0..pointer_height as i32 {
        let target_y = top + row;
        if target_y < 0 || target_y >= height as i32 {
            continue;
        }
        for col in 0..pointer_width as i32 {
            let target_x = left + col;
            if target_x < 0 || target_x >= width as i32 {
                continue;
            }
            let source = (row as u32 * pitch + col as u32 * 4) as usize;
            if source + 4 > pointer.len() {
                continue;
            }
            let alpha = pointer[source + 3] as u32;
            if alpha == 0 {
                continue;
            }
            let target = ((target_y as u32 * width) + target_x as u32) as usize * 4;
            for channel in 0..3 {
                let src = pointer[source + channel] as u32;
                let dst = bgra[target + channel] as u32;
                bgra[target + channel] = ((src * alpha + dst * (255 - alpha)) / 255) as u8;
            }
        }
    }
}

fn ensure_winrt() {
    static START: Once = Once::new();
    START.call_once(|| {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED).ok() };
    });
}

fn win_err(error: windows::core::Error) -> String {
    let message = error.message();
    if message.is_empty() { "Could not capture that screen.".into() } else { message.to_string() }
}

#[allow(dead_code)]
fn _rect_used(rect: RECT) -> i32 {
    rect.right
}
