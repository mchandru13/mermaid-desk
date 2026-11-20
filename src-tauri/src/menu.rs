//! Native application menu.
//!
//! Menu items only emit a command id; the React layer owns the behaviour so the
//! webview keyboard shortcuts and the menu share one implementation and the
//! app keeps working identically on macOS and Linux.

use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

pub const MENU_EVENT: &str = "menu-action";

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let new_diagram = MenuItemBuilder::with_id("new", "New Diagram").build(app)?;
    let open = MenuItemBuilder::with_id("open", "Open...\tCtrl+O").build(app)?;
    let save = MenuItemBuilder::with_id("save", "Save\tCtrl+S").build(app)?;
    let save_as = MenuItemBuilder::with_id("save-as", "Save As...\tCtrl+Shift+S").build(app)?;
    let export_svg = MenuItemBuilder::with_id("export-svg", "Export SVG...").build(app)?;
    let export_png = MenuItemBuilder::with_id("export-png", "Export PNG...").build(app)?;
    let close_tab = MenuItemBuilder::with_id("close-tab", "Close Diagram\tCtrl+W").build(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("Exit"))?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_diagram)
        .item(&open)
        .separator()
        .item(&save)
        .item(&save_as)
        .separator()
        .item(&export_svg)
        .item(&export_png)
        .separator()
        .item(&close_tab)
        .separator()
        .item(&quit)
        .build()?;

    let undo = PredefinedMenuItem::undo(app, Some("Undo"))?;
    let redo = PredefinedMenuItem::redo(app, Some("Redo"))?;
    let cut = PredefinedMenuItem::cut(app, Some("Cut"))?;
    let copy = PredefinedMenuItem::copy(app, Some("Copy"))?;
    let paste = PredefinedMenuItem::paste(app, Some("Paste"))?;
    let select_all = PredefinedMenuItem::select_all(app, Some("Select All"))?;
    let find = MenuItemBuilder::with_id("find", "Find\tCtrl+F").build(app)?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&undo)
        .item(&redo)
        .separator()
        .item(&cut)
        .item(&copy)
        .item(&paste)
        .item(&select_all)
        .separator()
        .item(&find)
        .build()?;

    let zoom_in = MenuItemBuilder::with_id("zoom-in", "Zoom In\tCtrl++").build(app)?;
    let zoom_out = MenuItemBuilder::with_id("zoom-out", "Zoom Out\tCtrl+-").build(app)?;
    let zoom_reset = MenuItemBuilder::with_id("zoom-reset", "Actual Size\tCtrl+0").build(app)?;
    let zoom_fit = MenuItemBuilder::with_id("zoom-fit", "Fit to Window\tCtrl+9").build(app)?;
    let toggle_theme =
        MenuItemBuilder::with_id("toggle-theme", "Toggle Theme\tCtrl+Shift+T").build(app)?;
    let toggle_preview =
        MenuItemBuilder::with_id("toggle-preview", "Toggle Preview\tCtrl+Shift+D").build(app)?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .item(&zoom_fit)
        .separator()
        .item(&toggle_preview)
        .item(&toggle_theme)
        .build()?;

    let templates = MenuItemBuilder::with_id("templates", "Insert Template...").build(app)?;
    let shortcuts = MenuItemBuilder::with_id("shortcuts", "Keyboard Shortcuts\tF1").build(app)?;
    let about = MenuItemBuilder::with_id("about", "About MermaidDesk").build(app)?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&templates)
        .separator()
        .item(&shortcuts)
        .item(&about)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&file_menu, &edit_menu, &view_menu, &help_menu])
        .build()?;

    app.set_menu(menu)?;

    app.on_menu_event(move |app, event| {
        let id = event.id().0.as_str().to_string();
        let _ = app.emit(MENU_EVENT, id);
    });

    Ok(())
}
