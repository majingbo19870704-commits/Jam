// Windows Release 时不弹出终端
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    personal_workstation_lib::run();
}
