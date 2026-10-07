// 仅由 AI 助手已确认的动作调用：在当前 Windows 用户权限下运行 PowerShell，
// 不提升权限、不隐藏输出，并将结果返回给前端审计层。
use serde::Deserialize;
use serde::Serialize;
use std::path::Path;
use std::time::{Duration, Instant};
use tokio::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandResult {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAutomationRequest {
    pub steps: Vec<DesktopAutomationStep>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAutomationStep {
    #[serde(rename = "type")]
    pub step_type: String,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub button: Option<String>,
    pub text: Option<String>,
    pub key: Option<String>,
    pub window_title: Option<String>,
    pub milliseconds: Option<u64>,
}

#[cfg(windows)]
struct WindowSearchContext {
    title_fragment: String,
    found: Option<windows_sys::Win32::Foundation::HWND>,
}

#[cfg(windows)]
unsafe extern "system" fn find_visible_window(
    hwnd: windows_sys::Win32::Foundation::HWND,
    lparam: windows_sys::Win32::Foundation::LPARAM,
) -> windows_sys::core::BOOL {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowTextW, IsWindowVisible};
    let context = unsafe { &mut *(lparam as *mut WindowSearchContext) };
    if unsafe { IsWindowVisible(hwnd) } == 0 {
        return 1;
    }
    let mut buffer = [0u16; 512];
    let length = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
    if length <= 0 {
        return 1;
    }
    let title = String::from_utf16_lossy(&buffer[..length as usize]).to_lowercase();
    if title.contains(&context.title_fragment) {
        context.found = Some(hwnd);
        0
    } else {
        1
    }
}

#[cfg(windows)]
fn focus_window(title_fragment: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, SetForegroundWindow};
    let title_fragment = title_fragment.trim();
    if title_fragment.is_empty() || title_fragment.chars().count() > 160 {
        return Err("窗口标题不能为空，且不能超过 160 个字符。".into());
    }
    let mut context = WindowSearchContext {
        title_fragment: title_fragment.to_lowercase(),
        found: None,
    };
    unsafe {
        EnumWindows(
            Some(find_visible_window),
            (&mut context as *mut WindowSearchContext) as isize,
        );
    }
    let window = context
        .found
        .ok_or("未找到标题匹配的可见窗口。请检查窗口标题是否准确。")?;
    if unsafe { SetForegroundWindow(window) } == 0 {
        return Err("Windows 未能将目标窗口切换至前台。".into());
    }
    std::thread::sleep(Duration::from_millis(250));
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAutomationResult {
    pub executed_steps: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopContext {
    pub screen_width: i32,
    pub screen_height: i32,
    pub cursor_x: i32,
    pub cursor_y: i32,
    pub foreground_window_title: Option<String>,
    pub foreground_window_bounds: Option<DesktopBounds>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBounds {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopScreenshot {
    pub data_url: String,
}

#[cfg(windows)]
fn window_title(hwnd: windows_sys::Win32::Foundation::HWND) -> Option<String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowTextW;
    let mut buffer = [0u16; 512];
    let length = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
    (length > 0).then(|| String::from_utf16_lossy(&buffer[..length as usize]))
}

#[tauri::command]
pub fn get_desktop_context() -> Result<DesktopContext, String> {
    #[cfg(not(windows))]
    {
        return Err("桌面上下文目前仅支持 Windows。".into());
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            Foundation::{POINT, RECT},
            UI::WindowsAndMessaging::{
                GetCursorPos, GetForegroundWindow, GetSystemMetrics, GetWindowRect,
            },
        };
        let mut cursor = POINT { x: 0, y: 0 };
        if unsafe { GetCursorPos(&mut cursor) } == 0 {
            return Err("Windows 无法读取鼠标位置。".into());
        }
        let foreground = unsafe { GetForegroundWindow() };
        let foreground_window_title = (!foreground.is_null())
            .then(|| window_title(foreground))
            .flatten();
        let mut rect = RECT::default();
        let foreground_window_bounds =
            if !foreground.is_null() && unsafe { GetWindowRect(foreground, &mut rect) } != 0 {
                Some(DesktopBounds {
                    left: rect.left,
                    top: rect.top,
                    width: rect.right.saturating_sub(rect.left),
                    height: rect.bottom.saturating_sub(rect.top),
                })
            } else {
                None
            };
        Ok(DesktopContext {
            screen_width: unsafe { GetSystemMetrics(0) },
            screen_height: unsafe { GetSystemMetrics(1) },
            cursor_x: cursor.x,
            cursor_y: cursor.y,
            foreground_window_title,
            foreground_window_bounds,
        })
    }
}

/// 截取当前主屏用于单次视觉请求。图像只返回给当前前端内存，调用方负责将它直接
/// 发送给用户选择的模型；不写入聊天记录、知识库或应用文件。
#[tauri::command]
pub async fn capture_desktop_screenshot() -> Result<DesktopScreenshot, String> {
    #[cfg(not(windows))]
    {
        return Err("桌面截图目前仅支持 Windows。".into());
    }
    #[cfg(windows)]
    {
        const SCRIPT: &str = r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$scale = [Math]::Min(1.0, [Math]::Min(1440.0 / $bounds.Width, 1000.0 / $bounds.Height))
$width = [Math]::Max(1, [int][Math]::Round($bounds.Width * $scale))
$height = [Math]::Max(1, [int][Math]::Round($bounds.Height * $scale))
$source = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$sourceGraphics = [System.Drawing.Graphics]::FromImage($source)
$sourceGraphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$output = New-Object System.Drawing.Bitmap $width, $height
$outputGraphics = [System.Drawing.Graphics]::FromImage($output)
$outputGraphics.DrawImage($source, 0, 0, $width, $height)
$memory = New-Object System.IO.MemoryStream
$output.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
[Console]::Out.Write([Convert]::ToBase64String($memory.ToArray()))
$memory.Dispose(); $outputGraphics.Dispose(); $output.Dispose(); $sourceGraphics.Dispose(); $source.Dispose()
"#;
        let output = tokio::time::timeout(
            Duration::from_secs(12),
            Command::new("powershell.exe")
                .args([
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    SCRIPT,
                ])
                .kill_on_drop(true)
                .output(),
        )
        .await
        .map_err(|_| "截取桌面超过 12 秒，已停止。")?
        .map_err(|error| format!("启动桌面截图失败: {error}"))?;
        if !output.status.success() {
            return Err("Windows 无法截取当前屏幕。".into());
        }
        let encoded = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if encoded.is_empty() || encoded.len() > 7 * 1024 * 1024 {
            return Err("桌面截图为空或超过允许大小。".into());
        }
        Ok(DesktopScreenshot {
            data_url: format!("data:image/png;base64,{encoded}"),
        })
    }
}

fn trim_output(value: Vec<u8>) -> String {
    String::from_utf8_lossy(&value)
        .chars()
        .take(12_000)
        .collect::<String>()
}

#[tauri::command]
pub async fn run_confirmed_terminal_command(
    command: String,
    working_dir: Option<String>,
) -> Result<TerminalCommandResult, String> {
    if command.trim().is_empty() || command.len() > 12_000 {
        return Err("终端命令不能为空，且不能超过 12000 个字符。".into());
    }
    if let Some(path) = working_dir
        .as_deref()
        .filter(|path| !path.trim().is_empty())
    {
        if !Path::new(path).is_absolute() || !Path::new(path).is_dir() {
            return Err("工作目录必须是已存在的绝对文件夹路径。".into());
        }
    }
    let mut process = Command::new("powershell.exe");
    process
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &command,
        ])
        .kill_on_drop(true);
    if let Some(path) = working_dir.filter(|path| !path.trim().is_empty()) {
        process.current_dir(path);
    }
    let child = process.output();
    match tokio::time::timeout(Duration::from_secs(60), child).await {
        Ok(Ok(output)) => Ok(TerminalCommandResult {
            exit_code: output.status.code(),
            stdout: trim_output(output.stdout),
            stderr: trim_output(output.stderr),
            timed_out: false,
        }),
        Ok(Err(error)) => Err(format!("启动或读取终端命令失败: {error}")),
        Err(_) => Err("终端命令超过 60 秒未完成，已停止。".into()),
    }
}

#[cfg(windows)]
fn send_inputs(
    inputs: &[windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT],
) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::SendInput;
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT>() as i32,
        )
    };
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err("Windows 未能完整发送输入事件。".into())
    }
}

#[cfg(windows)]
fn virtual_key_input(
    key: u16,
    flags: u32,
) -> windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
    };
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

#[cfg(windows)]
fn unicode_input(
    character: u16,
    flags: u32,
) -> windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_UNICODE,
    };
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: 0,
                wScan: character,
                dwFlags: KEYEVENTF_UNICODE | flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

#[cfg(windows)]
fn press_virtual_key(key: u16) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::KEYEVENTF_KEYUP;
    send_inputs(&[
        virtual_key_input(key, 0),
        virtual_key_input(key, KEYEVENTF_KEYUP),
    ])
}

#[cfg(windows)]
fn press_hotkey(keys: &[u16]) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::KEYEVENTF_KEYUP;
    let mut inputs = keys
        .iter()
        .map(|key| virtual_key_input(*key, 0))
        .collect::<Vec<_>>();
    inputs.extend(
        keys.iter()
            .rev()
            .map(|key| virtual_key_input(*key, KEYEVENTF_KEYUP)),
    );
    send_inputs(&inputs)
}

#[cfg(windows)]
fn type_unicode_text(text: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::KEYEVENTF_KEYUP;
    if text.chars().count() > 4_096 {
        return Err("单次文本输入不能超过 4096 个字符。".into());
    }
    let mut inputs = Vec::with_capacity(text.len() * 2);
    for character in text.encode_utf16() {
        inputs.push(unicode_input(character, 0));
        inputs.push(unicode_input(character, KEYEVENTF_KEYUP));
    }
    send_inputs(&inputs)
}

#[cfg(windows)]
fn click_at(x: i32, y: i32, button: &str, double: bool) -> Result<(), String> {
    use windows_sys::Win32::UI::{
        Input::KeyboardAndMouse::{
            mouse_event, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTDOWN,
            MOUSEEVENTF_RIGHTUP,
        },
        WindowsAndMessaging::SetCursorPos,
    };
    if !(-32_768..=32_767).contains(&x) || !(-32_768..=32_767).contains(&y) {
        return Err("桌面坐标超出允许范围。".into());
    }
    let positioned = unsafe { SetCursorPos(x, y) };
    if positioned == 0 {
        return Err("Windows 无法移动鼠标指针。".into());
    }
    let (down, up) = match button {
        "left" | "" => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
        "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        _ => return Err("鼠标按钮只能使用 left 或 right。".into()),
    };
    let count = if double { 2 } else { 1 };
    for _ in 0..count {
        unsafe {
            mouse_event(down, 0, 0, 0, 0);
            mouse_event(up, 0, 0, 0, 0);
        }
        if double {
            std::thread::sleep(Duration::from_millis(80));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn run_desktop_step(step: &DesktopAutomationStep) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        VK_BACK, VK_CONTROL, VK_DOWN, VK_ESCAPE, VK_F4, VK_LEFT, VK_MENU, VK_RETURN, VK_RIGHT,
        VK_SHIFT, VK_TAB, VK_UP,
    };
    match step.step_type.trim().to_ascii_lowercase().as_str() {
        "focus_window" => focus_window(
            step.window_title
                .as_deref()
                .ok_or("focus_window 操作缺少 windowTitle。")?,
        ),
        "click" => click_at(
            step.x.ok_or("click 操作缺少 x 坐标。")?,
            step.y.ok_or("click 操作缺少 y 坐标。")?,
            step.button.as_deref().unwrap_or("left"),
            false,
        ),
        "double_click" => click_at(
            step.x.ok_or("double_click 操作缺少 x 坐标。")?,
            step.y.ok_or("double_click 操作缺少 y 坐标。")?,
            step.button.as_deref().unwrap_or("left"),
            true,
        ),
        "type_text" => type_unicode_text(step.text.as_deref().ok_or("type_text 操作缺少 text。")?),
        "key" => match step
            .key
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_ascii_uppercase()
            .as_str()
        {
            "ENTER" => press_virtual_key(VK_RETURN),
            "TAB" => press_virtual_key(VK_TAB),
            "ESC" | "ESCAPE" => press_virtual_key(VK_ESCAPE),
            "BACKSPACE" => press_virtual_key(VK_BACK),
            "UP" => press_virtual_key(VK_UP),
            "DOWN" => press_virtual_key(VK_DOWN),
            "LEFT" => press_virtual_key(VK_LEFT),
            "RIGHT" => press_virtual_key(VK_RIGHT),
            "CTRL+A" => press_hotkey(&[VK_CONTROL, 0x41]),
            "CTRL+C" => press_hotkey(&[VK_CONTROL, 0x43]),
            "CTRL+V" => press_hotkey(&[VK_CONTROL, 0x56]),
            "ALT+F4" => press_hotkey(&[VK_MENU, VK_F4]),
            "SHIFT+TAB" => press_hotkey(&[VK_SHIFT, VK_TAB]),
            _ => Err(
                "支持的按键为 Enter、Tab、Esc、Backspace、方向键、Ctrl+A/C/V、Shift+Tab、Alt+F4。"
                    .into(),
            ),
        },
        "wait" => {
            let milliseconds = step.milliseconds.unwrap_or(500);
            if milliseconds > 10_000 {
                return Err("单次等待不能超过 10000 毫秒。".into());
            }
            std::thread::sleep(Duration::from_millis(milliseconds));
            Ok(())
        }
        _ => Err(
            "桌面步骤 type 仅支持 focus_window、click、double_click、type_text、key、wait。".into(),
        ),
    }
}

#[tauri::command]
pub fn run_confirmed_desktop_automation(
    request: DesktopAutomationRequest,
) -> Result<DesktopAutomationResult, String> {
    #[cfg(not(windows))]
    {
        let _ = request;
        return Err("桌面自动化目前仅支持 Windows。".into());
    }
    #[cfg(windows)]
    {
        if request.steps.is_empty() || request.steps.len() > 30 {
            return Err("桌面自动化必须包含 1 至 30 个步骤。".into());
        }
        let started = Instant::now();
        for step in &request.steps {
            if started.elapsed() > Duration::from_secs(60) {
                return Err("桌面自动化超过 60 秒，已停止后续步骤。".into());
            }
            run_desktop_step(step)?;
        }
        Ok(DesktopAutomationResult {
            executed_steps: request.steps.len(),
        })
    }
}
