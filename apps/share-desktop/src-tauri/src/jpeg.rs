use image::codecs::jpeg::JpegEncoder;
use image::{ImageBuffer, Rgb, Rgba};
use windows::core::w;
use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject, DrawTextW, SelectObject, SetBkMode, SetTextColor,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CLEARTYPE_QUALITY, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DEFAULT_PITCH, DIB_RGB_COLORS,
    DT_CENTER, DT_NOCLIP, DT_SINGLELINE, DT_VCENTER, FF_DONTCARE, FW_SEMIBOLD, HDC, HGDIOBJ, OUT_DEFAULT_PRECIS, TRANSPARENT,
};

use crate::picture::active_size;

pub fn encode_jpeg(bgra: &[u8], width: u32, height: u32, max_width: u32, quality: f64) -> Option<Vec<u8>> {
    if width < 2 || height < 2 || bgra.len() < (width as usize * height as usize * 4) {
        return None;
    }
    let mut limit = if max_width == 0 { width.min(2560) } else { max_width.min(width) };
    let mut sharpness = (quality.clamp(0.4, 0.95) * 100.0).round() as u8;
    for _ in 0..4 {
        let (rgb, out_width, out_height) = rgb(bgra, width, height, limit);
        let encoded = encode_rgb(&rgb, out_width, out_height, sharpness)?;
        if encoded.len() <= 1_600_000 || (out_width <= 960 && sharpness <= 60) {
            return Some(encoded);
        }
        if sharpness > 60 {
            sharpness = sharpness.saturating_sub(15).max(60);
        } else {
            limit = ((out_width as f32) * 0.75).round().max(960.0) as u32;
        }
    }
    None
}

pub fn preview_jpeg(bgra: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    encode_jpeg(bgra, width, height, 640, 0.7)
}

pub fn resting_jpeg(max_width: u32, source_width: u32, source_height: u32) -> Option<Vec<u8>> {
    let (width, height) = resting_size(max_width, source_width, source_height);
    let mut pixels = vec![0u8; width as usize * height as usize * 4];
    paint_resting(&mut pixels, width, height);
    let with_text = draw_label(&mut pixels, width, height).is_ok();
    if !with_text {
        paint_caption(&mut pixels, width, height);
    }
    encode_jpeg(&pixels, width, height, width, 0.9)
}

pub fn target_frame<'a>(bgra: &'a [u8], width: u32, height: u32, max_width: u32) -> Option<(Vec<u8>, u32, u32)> {
    let (target_width, target_height) = active_size(width, height, if max_width == 0 { 0 } else { max_width as i32 });
    if target_width == width && target_height == height {
        return Some((bgra.to_vec(), width, height));
    }
    Some(scale_bgra(bgra, width, height, target_width, target_height))
}

fn resting_size(max_width: u32, source_width: u32, source_height: u32) -> (u32, u32) {
    let width = max_width.clamp(960, source_width.max(max_width).max(960)).min(max_width.max(960));
    let width = width.max(960).min(if max_width > 0 { max_width.max(960) } else { source_width.max(960) });
    let ratio = if source_width > 0 && source_height > 0 {
        source_height as f32 / source_width as f32
    } else {
        9.0 / 16.0
    };
    let height = ((width as f32) * ratio).round().max(540.0) as u32;
    (width & !1, height.max(540) & !1)
}

fn paint_resting(pixels: &mut [u8], width: u32, height: u32) {
    let width = width as i32;
    let height = height as i32;
    for y in 0..height {
        for x in 0..width {
            let t = (x + y) as f32 / (width + height) as f32;
            let index = ((y as u32 * width as u32) + x as u32) as usize * 4;
            pixels[index] = lerp(19, 13, t);
            pixels[index + 1] = lerp(58, 23, t);
            pixels[index + 2] = lerp(49, 19, t);
            pixels[index + 3] = 255;
        }
    }
    let radius = (width as f32 * 0.2) as i32;
    let center_x = (width as f32 * 0.18) as i32;
    let center_y = (height as f32 * 0.16) as i32;
    for y in (center_y - radius).max(0)..(center_y + radius).min(height) {
        for x in (center_x - radius).max(0)..(center_x + radius).min(width) {
            let dx = x - center_x;
            let dy = y - center_y;
            if dx * dx + dy * dy <= radius * radius {
                let index = ((y as u32 * width as u32) + x as u32) as usize * 4;
                pixels[index] = 141;
                pixels[index + 1] = 206;
                pixels[index + 2] = 186;
                pixels[index + 3] = 255;
            }
        }
    }
}

fn paint_caption(pixels: &mut [u8], width: u32, height: u32) {
    let _ = (pixels, width, height);
}

fn draw_label(pixels: &mut [u8], width: u32, height: u32) -> Result<(), ()> {
    unsafe {
        let dc = CreateCompatibleDC(None);
        if dc.is_invalid() {
            return Err(());
        }
        let header = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let info = BITMAPINFO { bmiHeader: header, bmiColors: [Default::default()] };
        let mut bits = std::ptr::null_mut();
        let bitmap = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0).map_err(|_| ())?;
        if bits.is_null() {
            let _ = DeleteDC(dc);
            return Err(());
        }
        std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u8, pixels.len());
        let previous = SelectObject(dc, HGDIOBJ(bitmap.0));
        SetBkMode(dc, TRANSPARENT);
        SetTextColor(dc, windows::Win32::Foundation::COLORREF(0x00ffffff));
        let font = CreateFontW(
            (height / 16).max(28) as i32,
            0,
            0,
            0,
            FW_SEMIBOLD.0 as i32,
            0,
            0,
            0,
            DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,
            CLIP_DEFAULT_PRECIS,
            CLEARTYPE_QUALITY,
            (DEFAULT_PITCH.0 as u32) | (FF_DONTCARE.0 as u32),
            w!("Segoe UI"),
        );
        let previous_font = SelectObject(dc, HGDIOBJ::from(font));
        let mut title = RECT { left: 0, top: (height as i32) * 50 / 100, right: width as i32, bottom: (height as i32) * 62 / 100 };
        let mut subtitle = RECT { left: 0, top: (height as i32) * 62 / 100, right: width as i32, bottom: (height as i32) * 74 / 100 };
        draw(dc, "Display paused", &mut title, (height as i32) / 16);
        SetTextColor(dc, windows::Win32::Foundation::COLORREF(0x00c2c9b9));
        let small = CreateFontW(
            (height / 28).max(18) as i32,
            0,
            0,
            0,
            FW_SEMIBOLD.0 as i32,
            0,
            0,
            0,
            DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,
            CLIP_DEFAULT_PRECIS,
            CLEARTYPE_QUALITY,
            (DEFAULT_PITCH.0 as u32) | (FF_DONTCARE.0 as u32),
            w!("Segoe UI"),
        );
        SelectObject(dc, HGDIOBJ::from(small));
        draw(dc, "Ready when you are", &mut subtitle, (height as i32) / 28);
        std::ptr::copy_nonoverlapping(bits as *const u8, pixels.as_mut_ptr(), pixels.len());
        SelectObject(dc, previous_font);
        SelectObject(dc, previous);
        let _ = DeleteObject(HGDIOBJ::from(small));
        let _ = DeleteObject(HGDIOBJ::from(font));
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(dc);
    }
    Ok(())
}

unsafe fn draw(dc: HDC, text: &str, rect: &mut RECT, _size: i32) {
    let mut wide = text.encode_utf16().chain(std::iter::once(0)).collect::<Vec<_>>();
    let end = wide.len() - 1;
    let _ = DrawTextW(dc, &mut wide[..end], rect, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOCLIP);
}

fn rgb(bgra: &[u8], width: u32, height: u32, max_width: u32) -> (Vec<u8>, u32, u32) {
    let (bgra, width, height) = if max_width > 0 && max_width < width {
        let (target_width, target_height) = active_size(width, height, max_width as i32);
        scale_bgra(bgra, width, height, target_width, target_height)
    } else {
        (bgra.to_vec(), width, height)
    };
    let mut rgb = Vec::with_capacity(bgra.len() / 4 * 3);
    for pixel in bgra.chunks_exact(4) {
        rgb.push(pixel[2]);
        rgb.push(pixel[1]);
        rgb.push(pixel[0]);
    }
    (rgb, width, height)
}

fn scale_bgra(bgra: &[u8], width: u32, height: u32, target_width: u32, target_height: u32) -> (Vec<u8>, u32, u32) {
    let mut rgba = Vec::with_capacity(bgra.len());
    for pixel in bgra.chunks_exact(4) {
        rgba.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 255]);
    }
    let image = ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, rgba).expect("rgba frame");
    let scaled = image::imageops::resize(&image, target_width, target_height, image::imageops::FilterType::Triangle);
    let mut bgra = Vec::with_capacity(scaled.len() * 4);
    for pixel in scaled.pixels() {
        bgra.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 255]);
    }
    (bgra, target_width, target_height)
}

fn encode_rgb(rgb: &[u8], width: u32, height: u32, quality: u8) -> Option<Vec<u8>> {
    let image = ImageBuffer::<Rgb<u8>, _>::from_raw(width, height, rgb.to_vec())?;
    let mut bytes = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut bytes, quality);
    encoder.encode(image.as_raw(), width, height, image::ExtendedColorType::Rgb8).ok()?;
    Some(bytes)
}

fn lerp(from: u8, to: u8, t: f32) -> u8 {
    (from as f32 + (to as f32 - from as f32) * t).round().clamp(0.0, 255.0) as u8
}
