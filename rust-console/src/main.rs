#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use eframe::egui;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const BG: egui::Color32 = egui::Color32::from_rgb(7, 11, 20);
const PANEL: egui::Color32 = egui::Color32::from_rgb(10, 17, 31);
const CARD: egui::Color32 = egui::Color32::from_rgb(14, 23, 40);
const CARD_HI: egui::Color32 = egui::Color32::from_rgb(18, 30, 51);
const LINE: egui::Color32 = egui::Color32::from_rgb(30, 45, 69);
const TEXT: egui::Color32 = egui::Color32::from_rgb(231, 238, 249);
const MUTED: egui::Color32 = egui::Color32::from_rgb(139, 158, 188);
const ACCENT: egui::Color32 = egui::Color32::from_rgb(139, 92, 246);
const CYAN: egui::Color32 = egui::Color32::from_rgb(34, 211, 238);
const GREEN: egui::Color32 = egui::Color32::from_rgb(52, 211, 153);
const AMBER: egui::Color32 = egui::Color32::from_rgb(251, 191, 36);
const RED: egui::Color32 = egui::Color32::from_rgb(251, 113, 133);

const PROVIDERS: [(&str, &str); 17] = [
    ("nightrouter", "NightRouter"),
    ("exosai", "ExosAI"),
    ("mistral", "Mistral"),
    ("inception", "Inception"),
    ("furry", "Furry"),
    ("bazaarlink", "BazaarLink"),
    ("nagaai", "NagaAI"),
    ("airforce", "ApiAirforce"),
    ("dreamprompting", "DreamPrompting"),
    ("crowllm", "CrowLLM"),
    ("aibridge", "AIBridge"),
    ("routeway", "Routeway"),
    ("raon", "Raon/Krafton"),
    ("codiv", "Codiv"),
    ("maritaca", "Maritaca"),
    ("exaone", "ExaOne"),
    ("blaze", "BlazeAPI"),
];

const PROVIDER_LINKS: [(&str, &str); 17] = [
    ("nightrouter", "https://nightrouter.ai"),
    ("exosai", "https://api.exosai.tech"),
    ("mistral", "https://console.mistral.ai"),
    ("inception", "https://platform.inceptionlabs.ai"),
    ("furry", "https://ai.furry.edu.gr"),
    ("bazaarlink", "https://bazaarlink.ai"),
    ("nagaai", "https://naga.ac"),
    ("airforce", "https://api.airforce"),
    ("dreamprompting", "https://dreamprompting.com"),
    ("crowllm", "https://crowllm.com"),
    ("aibridge", "https://aibridge-api.com/dashboard.html"),
    ("routeway", "https://routeway.ai"),
    ("raon", "https://raon-console.krafton.ai"),
    ("codiv", "https://codiv.ai/dashboard"),
    ("maritaca", "https://plataforma.maritaca.ai"),
    ("exaone", "https://docs.exaone.ai/ko/docs/overview"),
    ("blaze", "https://blazeapi.org/models"),
];

fn provider_link(id: &str) -> Option<&'static str> {
    PROVIDER_LINKS.iter().find(|(key, _)| *key == id).map(|(_, url)| *url)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tab {
    Dashboard,
    Users,
    ProviderKeys,
    Models,
    Payments,
    Settings,
}

impl Tab {
    fn title(self) -> &'static str {
        match self {
            Tab::Dashboard => "Dashboard",
            Tab::Users => "Users & plans",
            Tab::ProviderKeys => "Provider keys",
            Tab::Models => "Models",
            Tab::Payments => "Payments",
            Tab::Settings => "Settings",
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct Config {
    project_root: String,
    backend_url: String,
    admin_email: String,
    admin_password: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            project_root: std::env::var("NOVA_PROJECT_ROOT").unwrap_or_else(|_| {
                "C:\\Users\\Noway\\.zcode\\workspace\\draft-60239bfb-6fe8-4c79-b711-96d4850b85c5"
                    .to_string()
            }),
            backend_url: "https://novarouter.cc.cd".to_string(),
            admin_email: "admin@novacompute.io".to_string(),
            admin_password: "change-me".to_string(),
        }
    }
}

#[derive(Clone, Default)]
struct ProviderKey {
    index: usize,
    masked: String,
    status: String,
}

#[derive(Clone, Default)]
struct ModelForm {
    id: String,
    name: String,
    provider: String,
    context: String,
    speed: f64,
    input: f64,
    output: f64,
    price_per_request: f64,
    category: String,
    upstream: String,
    upstream_id: String,
    tag: String,
    note: String,
    price_unit: String,
    image: bool,
    video: bool,
}

struct App {
    cfg: Config,
    cfg_path: PathBuf,
    tab: Tab,
    api_key: String,
    health: String,
    overview: Value,
    users: Vec<Value>,
    transactions: Vec<Value>,
    models: Vec<Value>,
    custom_models: Vec<Value>,
    hidden_models: Vec<Value>,
    provider_keys: BTreeMap<String, Vec<ProviderKey>>,
    key_input: BTreeMap<String, String>,
    paypal_orders: Value,
    bank_txns: Value,
    status: String,
    search: String,
    model_search: String,
    model_form: ModelForm,
    confirm_delete: Option<String>,
}

impl App {
    fn new(cc: &eframe::CreationContext<'_>) -> Self {
        setup_style(&cc.egui_ctx);
        let cfg_path = config_path();
        let cfg = load_config(&cfg_path);
        let start_tab = match std::env::var("NOVA_CONSOLE_TAB").unwrap_or_default().to_lowercase().as_str() {
            "users" => Tab::Users,
            "keys" | "provider-keys" => Tab::ProviderKeys,
            "models" => Tab::Models,
            "payments" => Tab::Payments,
            "settings" => Tab::Settings,
            _ => Tab::Dashboard,
        };
        let mut app = Self {
            cfg,
            cfg_path,
            tab: start_tab,
            api_key: String::new(),
            health: "checking…".to_string(),
            overview: Value::Null,
            users: Vec::new(),
            transactions: Vec::new(),
            models: Vec::new(),
            custom_models: Vec::new(),
            hidden_models: Vec::new(),
            provider_keys: BTreeMap::new(),
            key_input: BTreeMap::new(),
            paypal_orders: Value::Null,
            bank_txns: Value::Null,
            status: String::new(),
            search: String::new(),
            model_search: String::new(),
            model_form: ModelForm::default(),
            confirm_delete: None,
        };
        app.refresh();
        app
    }

    fn backend(&self) -> String {
        self.cfg.backend_url.trim_end_matches('/').to_string()
    }

    fn backend_dir(&self) -> PathBuf {
        PathBuf::from(&self.cfg.project_root).join("backend")
    }

    fn api_get(&self, path: &str) -> Result<Value, String> {
        let url = format!("{}{}", self.backend(), path);
        let mut req = ureq::get(&url).timeout(Duration::from_secs(5));
        if !self.api_key.is_empty() {
            req = req.set("Authorization", &format!("Bearer {}", self.api_key));
        }
        match req.call() {
            Ok(resp) => resp.into_json::<Value>().map_err(|e| e.to_string()),
            Err(ureq::Error::Status(code, resp)) => Err(format!(
                "HTTP {}: {}",
                code,
                resp.into_string().unwrap_or_default()
            )),
            Err(e) => Err(e.to_string()),
        }
    }

    fn api_post(&self, path: &str, body: Value) -> Result<Value, String> {
        let url = format!("{}{}", self.backend(), path);
        let mut req = ureq::post(&url).timeout(Duration::from_secs(8));
        if !self.api_key.is_empty() {
            req = req.set("Authorization", &format!("Bearer {}", self.api_key));
        }
        match req.send_json(body) {
            Ok(resp) => resp.into_json::<Value>().map_err(|e| e.to_string()),
            Err(ureq::Error::Status(code, resp)) => Err(format!(
                "HTTP {}: {}",
                code,
                resp.into_string().unwrap_or_default()
            )),
            Err(e) => Err(e.to_string()),
        }
    }

    fn login(&mut self) {
        let url = format!("{}/api/login", self.backend());
        let body = json!({
            "email": self.cfg.admin_email,
            "password": self.cfg.admin_password,
        });
        match ureq::post(&url)
            .timeout(Duration::from_secs(6))
            .send_json(body)
        {
            Ok(resp) => match resp.into_json::<Value>() {
                Ok(v) => {
                    self.api_key = v["api_key"].as_str().unwrap_or("").to_string();
                    if self.api_key.is_empty() {
                        self.status = "Admin login returned no API key.".to_string();
                    }
                }
                Err(e) => self.status = format!("Login parse: {e}"),
            },
            Err(ureq::Error::Status(code, _)) => {
                self.status = format!("Admin login failed (HTTP {code}). Check Settings.");
            }
            Err(e) => self.status = format!("Backend offline: {e}"),
        }
    }

    fn refresh(&mut self) {
        self.status.clear();
        if self.api_key.is_empty() {
            self.login();
        }
        match self.api_get("/api/health") {
            Ok(v) => {
                self.health = format!(
                    "ok · {} models · {} keys",
                    v["models"].as_i64().unwrap_or(0),
                    v["keys_loaded"].as_i64().unwrap_or(0)
                )
            }
            Err(e) => self.health = format!("offline · {e}"),
        }
        if let Ok(v) = self.api_get("/api/admin/overview") {
            self.overview = v;
        }
        if let Ok(v) = self.api_get("/api/admin/users") {
            self.users = v["users"].as_array().cloned().unwrap_or_default();
        }
        if let Ok(v) = self.api_get("/api/admin/transactions") {
            self.transactions = v["transactions"].as_array().cloned().unwrap_or_default();
        }
        if let Ok(v) = self.api_get("/v1/models") {
            self.models = v["data"].as_array().cloned().unwrap_or_default();
        }
        self.load_provider_keys();
        self.load_custom_models();
        self.load_payment_state();
    }

    fn load_provider_keys(&mut self) {
        self.provider_keys.clear();
        for (id, _) in PROVIDERS {
            self.provider_keys.insert(id.to_string(), Vec::new());
            self.key_input.entry(id.to_string()).or_default();
        }
        if let Ok(v) = self.api_get("/api/admin/provider-keys") {
            for provider in v["providers"].as_array().cloned().unwrap_or_default() {
                let id = provider["id"].as_str().unwrap_or("").to_string();
                let keys = provider["keys"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|key| ProviderKey {
                        index: key["index"].as_u64().unwrap_or(0) as usize,
                        masked: key["masked"].as_str().unwrap_or("").to_string(),
                        status: key["status"].as_str().unwrap_or("active").to_string(),
                    })
                    .collect();
                self.provider_keys.insert(id, keys);
            }
        }
    }

    fn load_custom_models(&mut self) {
        if let Ok(v) = self.api_get("/api/admin/models") {
            self.models = v["models"].as_array().cloned().unwrap_or_default();
            self.custom_models = v["custom"].as_array().cloned().unwrap_or_default();
            self.hidden_models = v["hidden"].as_array().cloned().unwrap_or_default();
        }
    }

    fn load_payment_state(&mut self) {
        if let Ok(v) = self.api_get("/api/admin/payments") {
            self.paypal_orders = v["paypal_orders"].clone();
            self.bank_txns = v["bank_txns"].clone();
        }
    }

    fn add_provider_key(&mut self, provider: &str) {
        let value = self.key_input.get(provider).cloned().unwrap_or_default();
        let value = value.trim().to_string();
        if value.is_empty() {
            return;
        }
        match self.api_post("/api/admin/provider-keys", json!({
            "provider": provider, "action": "add", "key": value
        })) {
            Ok(_) => {
                self.key_input.insert(provider.to_string(), String::new());
                self.status = format!("Key added to {provider}. Live — no restart or deploy needed.");
                self.load_provider_keys();
            }
            Err(e) => self.status = format!("Add key failed: {e}"),
        }
    }

    fn delete_provider_key(&mut self, provider: &str, index: usize) {
        match self.api_post("/api/admin/provider-keys", json!({
            "provider": provider, "action": "delete", "index": index
        })) {
            Ok(_) => {
                self.status = format!("Key removed from {provider}. Live — no restart needed.");
                self.load_provider_keys();
            }
            Err(e) => self.status = format!("Delete key failed: {e}"),
        }
    }

    fn admin_update(&mut self, email: &str, payload: Value) {
        let mut body = json!({ "email": email });
        if let Some(obj) = body.as_object_mut() {
            if let Some(p) = payload.as_object() {
                for (k, v) in p {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
        match self.api_post("/api/admin/user", body) {
            Ok(_) => {
                self.status = format!("Updated {email}.");
                self.refresh();
            }
            Err(e) => self.status = format!("Update failed: {e}"),
        }
    }

    fn admin_delete(&mut self, email: &str) {
        match self.api_post("/api/admin/user/delete", json!({ "email": email })) {
            Ok(_) => {
                self.status = format!("Deleted {email}.");
                self.refresh();
            }
            Err(e) => self.status = format!("Delete failed: {e}"),
        }
    }

    fn save_custom_model(&mut self) {
        let f = &self.model_form;
        if f.id.trim().is_empty() || f.name.trim().is_empty() {
            self.status = "Model ID and name are required.".to_string();
            return;
        }
        let id = f.id.trim().to_string();
        let entry = json!({
            "id": id,
            "name": f.name.trim(),
            "provider": if f.provider.trim().is_empty() { "Custom" } else { f.provider.trim() },
            "context": if f.context.trim().is_empty() { "—" } else { f.context.trim() },
            "speed": f.speed,
            "input": f.input,
            "output": f.output,
            "price_per_request": f.price_per_request,
            "category": if f.category.trim().is_empty() { "chat" } else { f.category.trim() },
            "tag": if f.tag.trim().is_empty() { Value::Null } else { json!(f.tag.trim()) },
            "note": f.note.trim(),
            "price_unit": if f.price_unit.trim().is_empty() { "" } else { f.price_unit.trim() },
            "image": f.image,
            "video": f.video,
            "upstream": f.upstream.trim(),
            "upstream_id": f.upstream_id.trim(),
        });
        match self.api_post("/api/admin/models", json!({"action": "save", "model": entry})) {
            Ok(v) => {
                self.apply_models_payload(&v);
                self.status = format!("Saved {id}. Live catalogue updated — no restart or deploy needed.");
            }
            Err(e) => self.status = format!("Save model failed: {e}"),
        }
    }

    fn apply_models_payload(&mut self, v: &Value) {
        self.models = v["models"].as_array().cloned().unwrap_or_default();
        self.custom_models = v["custom"].as_array().cloned().unwrap_or_default();
        self.hidden_models = v["hidden"].as_array().cloned().unwrap_or_default();
    }

    fn delete_custom_model(&mut self, id: &str, reset_only: bool) {
        let action = if reset_only { "reset" } else { "delete" };
        match self.api_post("/api/admin/models", json!({"action": action, "id": id})) {
            Ok(v) => {
                self.apply_models_payload(&v);
                self.status = if reset_only {
                    format!("Reset {id} to its base definition.")
                } else {
                    format!("Removed {id} from the live catalogue.")
                };
            }
            Err(e) => self.status = format!("Remove model failed: {e}"),
        }
    }

    fn save_config(&mut self) {
        match write_json(&self.cfg_path, &serde_json::to_value(&self.cfg).unwrap_or(Value::Null)) {
            Ok(_) => {
                self.status = "Settings saved.".to_string();
                self.api_key.clear();
                self.refresh();
            }
            Err(e) => self.status = format!("Save settings failed: {e}"),
        }
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        egui::SidePanel::left("sidebar")
            .resizable(false)
            .default_width(244.0)
            .frame(egui::Frame::default().fill(PANEL).inner_margin(16.0))
            .show(ctx, |ui| {
                ui.add_space(4.0);
                ui.horizontal(|ui| {
                    egui::Frame::new()
                        .fill(ACCENT)
                        .corner_radius(egui::CornerRadius::same(10))
                        .inner_margin(egui::Margin::symmetric(10, 8))
                        .show(ui, |ui| {
                            ui.label(egui::RichText::new("N").size(17.0).strong().color(egui::Color32::WHITE));
                        });
                    ui.vertical(|ui| {
                        ui.label(egui::RichText::new("NovaCompute").size(18.0).strong().color(TEXT));
                        ui.label(egui::RichText::new("ADMIN CONSOLE").size(9.0).strong().color(AMBER));
                    });
                });
                ui.add_space(22.0);
                for (tab, icon, label) in [
                    (Tab::Dashboard, "●", "Dashboard"),
                    (Tab::Users, "●", "Users & plans"),
                    (Tab::ProviderKeys, "●", "Provider keys"),
                    (Tab::Models, "●", "Models"),
                    (Tab::Payments, "●", "Payments"),
                    (Tab::Settings, "●", "Settings"),
                ] {
                    if nav_item(ui, self.tab == tab, icon, label) {
                        self.tab = tab;
                    }
                    ui.add_space(3.0);
                }
                ui.with_layout(egui::Layout::bottom_up(egui::Align::LEFT), |ui| {
                    ui.label(egui::RichText::new("v0.2 · live sync").size(9.0).color(MUTED));
                    ui.add_space(4.0);
                    ui.horizontal(|ui| {
                        let host = self.backend().replace("https://", "").replace("http://", "");
                        ui.label(egui::RichText::new(host).size(10.0).monospace().color(CYAN));
                        pill(ui, "LIVE", GREEN);
                    });
                    ui.add_space(8.0);
                    if ui.button("Open storefront").clicked() {
                        open_url(&self.backend());
                    }
                    ui.add_space(6.0);
                    ui.label(egui::RichText::new(&self.cfg.admin_email).size(10.0).color(MUTED));
                    ui.add_space(10.0);
                    ui.separator();
                    ui.add_space(8.0);
                    if ui.button("Sign in again").clicked() {
                        self.api_key.clear();
                        self.login();
                    }
                });
            });

        egui::TopBottomPanel::top("top")
            .frame(
                egui::Frame::default()
                    .fill(BG)
                    .stroke(egui::Stroke::new(1.0, LINE))
                    .inner_margin(egui::Margin::symmetric(22, 14)),
            )
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.vertical(|ui| {
                        ui.label(egui::RichText::new(self.tab.title()).size(24.0).strong().color(TEXT));
                        ui.label(egui::RichText::new("Live control plane · changes apply immediately").size(11.0).color(MUTED));
                    });
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.button("Refresh").clicked() {
                            self.refresh();
                        }
                        let color = if self.health.starts_with("ok") { GREEN } else { RED };
                        pill(ui, &self.health, color);
                    });
                });
            });

        egui::CentralPanel::default()
            .frame(egui::Frame::default().fill(BG).inner_margin(22.0))
            .show(ctx, |ui| {
                if !self.status.is_empty() {
                    egui::Frame::new()
                        .fill(egui::Color32::from_rgba_unmultiplied(AMBER.r(), AMBER.g(), AMBER.b(), 20))
                        .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgba_unmultiplied(AMBER.r(), AMBER.g(), AMBER.b(), 70)))
                        .corner_radius(egui::CornerRadius::same(8))
                        .inner_margin(egui::Margin::symmetric(12, 8))
                        .show(ui, |ui| {
                            ui.label(egui::RichText::new(&self.status).size(12.0).color(AMBER));
                        });
                    ui.add_space(10.0);
                }
                egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| match self.tab {
                    Tab::Dashboard => self.ui_dashboard(ui),
                    Tab::Users => self.ui_users(ui),
                    Tab::ProviderKeys => self.ui_provider_keys(ui),
                    Tab::Models => self.ui_models(ui),
                    Tab::Payments => self.ui_payments(ui),
                    Tab::Settings => self.ui_settings(ui),
                });
            });

        if let Some(email) = self.confirm_delete.clone() {
            let mut confirm = false;
            let mut cancel = false;
            egui::Window::new("Delete account")
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .show(ctx, |ui| {
                    ui.label(format!("Delete {email}? This removes the account, its keys and usage."));
                    ui.add_space(8.0);
                    ui.horizontal(|ui| {
                        if ui.button("Delete").clicked() { confirm = true; }
                        if ui.button("Cancel").clicked() { cancel = true; }
                    });
                });
            if confirm {
                self.admin_delete(&email);
                self.confirm_delete = None;
            } else if cancel {
                self.confirm_delete = None;
            }
        }
    }
}

impl App {
    fn ui_dashboard(&mut self, ui: &mut egui::Ui) {
        let users = num(&self.overview, "users");
        let plans = num(&self.overview, "active_plans");
        let revenue = money(num(&self.overview, "revenue"));
        let reqs = num(&self.overview, "requests_today");
        let free = self.overview["free_seats"].clone();
        let claimed = num(&free, "claimed");
        let limit = num(&free, "limit");
        let remaining = num(&free, "remaining");
        ui.columns(4, |cols| {
            stat_card(&mut cols[0], "CUSTOMERS", &users.to_string(), "registered accounts", ACCENT);
            stat_card(&mut cols[1], "ACTIVE PLANS", &plans.to_string(), "monthly quota plans", CYAN);
            stat_card(&mut cols[2], "REVENUE", &revenue, "top-ups + subscriptions", GREEN);
            stat_card(&mut cols[3], "REQUESTS TODAY", &reqs.to_string(), "all models", AMBER);
        });
        ui.add_space(12.0);
        ui.columns(4, |cols| {
            let keys: usize = self.provider_keys.values().map(Vec::len).sum();
            stat_card(&mut cols[0], "PROVIDER KEYS", &keys.to_string(), "across 14 upstreams", ACCENT);
            stat_card(&mut cols[1], "MODELS", &self.models.len().to_string(), "live catalogue", CYAN);
            stat_card(&mut cols[2], "FREE SEATS", &format!("{}/{}", claimed, limit), &format!("{} remaining", remaining), GREEN);
            stat_card(&mut cols[3], "BALANCES", &money(num(&self.overview, "total_balance")), "customer balances", AMBER);
        });
        ui.add_space(16.0);
        egui::Frame::group(ui.style())
            .fill(CARD)
            .stroke(egui::Stroke::new(1.0, LINE))
            .inner_margin(16.0)
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label(egui::RichText::new("Quick controls").size(14.0).strong().color(TEXT));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.button("Open storefront").clicked() { open_url(&self.backend()); }
                    });
                });
                ui.add_space(8.0);
                ui.horizontal_wrapped(|ui| {
                    if ui.button("Add provider key").clicked() { self.tab = Tab::ProviderKeys; }
                    if ui.button("Edit models").clicked() { self.tab = Tab::Models; }
                    if ui.button("Manage customers").clicked() { self.tab = Tab::Users; }
                    if ui.button("Payments").clicked() { self.tab = Tab::Payments; }
                    if ui.button("Web admin").clicked() { open_url(&format!("{}/admin.html", self.backend())); }
                });
                ui.add_space(6.0);
                ui.label(egui::RichText::new("API keys and model edits are written to the live backend instantly. No deploy or restart is required.")
                    .size(11.0).color(MUTED));
            });
        ui.add_space(14.0);
        let users_preview = self.users.clone();
        let tx_preview = self.transactions.clone();
        ui.columns(2, |cols| {
            egui::Frame::group(cols[0].style())
                .fill(CARD)
                .stroke(egui::Stroke::new(1.0, LINE))
                .inner_margin(14.0)
                .show(&mut cols[0], |ui| {
                    ui.horizontal(|ui| {
                        ui.label(egui::RichText::new("Recent customers").size(14.0).strong().color(TEXT));
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            if ui.small_button("View all").clicked() { self.tab = Tab::Users; }
                        });
                    });
                    ui.add_space(6.0);
                    if users_preview.is_empty() {
                        ui.label(egui::RichText::new("No accounts yet.").size(12.0).color(MUTED));
                    }
                    for u in users_preview.iter().take(5) {
                        ui.horizontal(|ui| {
                            ui.vertical(|ui| {
                                ui.label(egui::RichText::new(u["email"].as_str().unwrap_or("")).size(11.0).color(TEXT));
                                ui.label(egui::RichText::new(plan_label(u["plan"].as_str().unwrap_or("free"))).size(9.0).color(MUTED));
                            });
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                if u["free_seat"].as_bool().unwrap_or(false) { pill(ui, "FREE SEAT", GREEN); }
                                ui.label(egui::RichText::new(money(u["balance"].as_f64().unwrap_or(0.0))).size(11.0).color(GREEN));
                            });
                        });
                    }
                });
            egui::Frame::group(cols[1].style())
                .fill(CARD)
                .stroke(egui::Stroke::new(1.0, LINE))
                .inner_margin(14.0)
                .show(&mut cols[1], |ui| {
                    ui.horizontal(|ui| {
                        ui.label(egui::RichText::new("Recent activity").size(14.0).strong().color(TEXT));
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            if ui.small_button("View all").clicked() { self.tab = Tab::Payments; }
                        });
                    });
                    ui.add_space(6.0);
                    if tx_preview.is_empty() {
                        ui.label(egui::RichText::new("No transactions yet.").size(12.0).color(MUTED));
                    }
                    for t in tx_preview.iter().take(5) {
                        ui.horizontal(|ui| {
                            ui.vertical(|ui| {
                                ui.label(egui::RichText::new(t["description"].as_str().unwrap_or("")).size(11.0).color(TEXT));
                                ui.label(egui::RichText::new(format!("{} · {}", t["email"].as_str().unwrap_or(""), date_ts(t["ts"].as_i64().unwrap_or(0)))).size(9.0).color(MUTED));
                            });
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                let amount = t["amount"].as_f64().unwrap_or(0.0);
                                ui.label(egui::RichText::new(money(amount)).size(11.0).color(if amount > 0.0 { GREEN } else { TEXT }));
                            });
                        });
                    }
                });
        });
        ui.add_space(14.0);
        egui::Frame::group(ui.style())
            .fill(CARD)
            .stroke(egui::Stroke::new(1.0, LINE))
            .inner_margin(14.0)
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label(egui::RichText::new("Admin session").size(14.0).strong().color(TEXT));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.button("Open web admin").clicked() {
                            open_url(&format!("{}/admin.html", self.backend()));
                        }
                    });
                });
                ui.label(egui::RichText::new(&self.cfg.admin_email).monospace().size(11.0).color(CYAN));
                ui.label(egui::RichText::new("The native console talks to the live backend with this admin account. Credentials are stored in console_config.json next to the executable.")
                    .size(10.0).color(MUTED));
            });
    }

    fn ui_users(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.vertical(|ui| {
                ui.label(egui::RichText::new("Customers").size(22.0).strong().color(TEXT));
                ui.label(egui::RichText::new("Plans, balances, free seats, access and bans.").size(12.0).color(MUTED));
            });
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("Refresh").clicked() { self.refresh(); }
                ui.add(egui::TextEdit::singleline(&mut self.search).hint_text("Search email or name…").desired_width(260.0));
            });
        });
        ui.add_space(10.0);
        let search = self.search.to_lowercase();
        let mut actions: Vec<(String, Value)> = Vec::new();
        let mut delete_request: Option<String> = None;
        egui::Frame::group(ui.style())
            .fill(CARD)
            .stroke(egui::Stroke::new(1.0, LINE))
            .inner_margin(14.0)
            .show(ui, |ui| {
                egui::ScrollArea::horizontal().show(ui, |ui| {
                    egui::Grid::new("users-grid")
                        .striped(true)
                        .num_columns(10)
                        .min_col_width(62.0)
                        .spacing([16.0, 10.0])
                        .show(ui, |ui| {
                            for h in ["Account", "Plan", "Balance / adjust", "Seat", "Admin", "Banned", "Requests", "Tokens", "Last used", ""] {
                                ui.label(egui::RichText::new(h).size(10.0).strong().color(MUTED));
                            }
                            ui.end_row();
                            for u in &self.users {
                                let email = u["email"].as_str().unwrap_or("").to_string();
                                let name = u["name"].as_str().unwrap_or("");
                                if !search.is_empty()
                                    && !email.to_lowercase().contains(&search)
                                    && !name.to_lowercase().contains(&search)
                                {
                                    continue;
                                }
                                ui.vertical(|ui| {
                                    ui.set_min_width(190.0);
                                    ui.label(egui::RichText::new(if name.is_empty() { &email } else { name }).color(TEXT).strong());
                                    ui.label(egui::RichText::new(&email).size(10.0).monospace().color(MUTED));
                                });
                                let mut plan = u["plan"].as_str().unwrap_or("free").to_string();
                                let before = plan.clone();
                                egui::ComboBox::from_id_salt(format!("plan-{email}"))
                                    .width(112.0)
                                    .selected_text(plan_label(&plan))
                                    .show_ui(ui, |ui| {
                                        for p in ["free", "starter", "pro", "ultra"] {
                                            ui.selectable_value(&mut plan, p.to_string(), plan_label(p));
                                        }
                                    });
                                if plan != before {
                                    actions.push((email.clone(), json!({ "plan": plan })));
                                }
                                ui.vertical(|ui| {
                                    ui.set_min_width(130.0);
                                    ui.label(egui::RichText::new(money(u["balance"].as_f64().unwrap_or(0.0))).color(GREEN).strong());
                                    let mut delta = 0.0;
                                    ui.horizontal(|ui| {
                                        ui.add(
                                            egui::DragValue::new(&mut delta)
                                                .speed(1.0)
                                                .prefix("±$")
                                                .range(-1000.0..=1000.0),
                                        );
                                        if ui.small_button("Apply").clicked() && delta != 0.0 {
                                            actions.push((email.clone(), json!({ "balance_delta": delta })));
                                        }
                                    });
                                });
                                if u["free_seat"].as_bool().unwrap_or(false) {
                                    pill(ui, "FREE", GREEN);
                                } else {
                                    ui.label(egui::RichText::new("—").color(MUTED));
                                }
                                let mut admin = u["is_admin"].as_bool().unwrap_or(false);
                                if ui.checkbox(&mut admin, "").changed() {
                                    actions.push((email.clone(), json!({ "is_admin": admin })));
                                }
                                let mut banned = u["banned"].as_bool().unwrap_or(false);
                                if ui.checkbox(&mut banned, "").changed() {
                                    actions.push((email.clone(), json!({ "banned": banned })));
                                }
                                ui.label(num(u, "requests").to_string());
                                ui.label(short_num(num(u, "tokens")));
                                ui.label(time_ago(u["last_used"].as_i64().unwrap_or(0)));
                                if ui.small_button("Delete").clicked() {
                                    delete_request = Some(email.clone());
                                }
                                ui.end_row();
                            }
                        });
                });
                if self.users.is_empty() {
                    ui.add_space(6.0);
                    ui.label(egui::RichText::new("No customer accounts yet.").size(12.0).color(MUTED));
                }
            });
        if let Some(email) = delete_request {
            self.confirm_delete = Some(email);
        }
        for (email, payload) in actions {
            self.admin_update(&email, payload);
        }
    }

    fn ui_provider_keys(&mut self, ui: &mut egui::Ui) {
        let mut add: Option<String> = None;
        let mut delete: Option<(String, usize)> = None;
        ui.horizontal(|ui| {
            ui.vertical(|ui| {
                ui.label(egui::RichText::new("Provider keys").size(22.0).strong().color(TEXT));
                ui.label(egui::RichText::new("Live pools read by the gateway on every request. Changes apply instantly — no restart, no deploy.")
                    .size(12.0).color(MUTED));
            });
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                pill(ui, "LIVE SYNC", GREEN);
                if ui.button("Refresh").clicked() { self.refresh(); }
            });
        });
        ui.add_space(12.0);
        for (id, title) in PROVIDERS {
            let keys = self.provider_keys.get(id).cloned().unwrap_or_default();
            egui::Frame::group(ui.style())
                .fill(CARD)
                .stroke(egui::Stroke::new(1.0, LINE))
                .inner_margin(16.0)
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.label(egui::RichText::new(title).size(16.0).strong().color(TEXT));
                        pill(ui, &format!("{} KEYS", keys.len()), if keys.is_empty() { RED } else { GREEN });
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            ui.label(egui::RichText::new(id).size(11.0).monospace().color(MUTED));
                            if let Some(url) = provider_link(id) {
                                ui.hyperlink_to("Provider ↗", url);
                            }
                        });
                    });
                    ui.add_space(6.0);
                    if keys.is_empty() {
                        ui.label(egui::RichText::new("No keys in this pool. Add one below.").size(12.0).color(AMBER));
                    }
                    egui::ScrollArea::vertical()
                        .max_height(230.0)
                        .auto_shrink([false, true])
                        .show(ui, |ui| {
                            for key in keys {
                                ui.horizontal(|ui| {
                                    ui.label(egui::RichText::new(&key.masked).monospace().size(13.0).color(TEXT));
                                    let color = if key.status == "active" { GREEN } else { AMBER };
                                    ui.label(egui::RichText::new(format!("● {}", key.status)).size(10.0).color(color));
                                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                        if ui.small_button("Delete").clicked() {
                                            delete = Some((id.to_string(), key.index));
                                        }
                                    });
                                });
                            }
                        });
                    ui.add_space(6.0);
                    ui.horizontal(|ui| {
                        let input = self.key_input.entry(id.to_string()).or_default();
                        ui.add(
                            egui::TextEdit::singleline(input)
                                .hint_text("Paste a new upstream API key")
                                .desired_width(420.0),
                        );
                        if ui.button("Add key").clicked() {
                            add = Some(id.to_string());
                        }
                    });
                });
            ui.add_space(8.0);
        }
        if let Some(provider) = add { self.add_provider_key(&provider); }
        if let Some((provider, index)) = delete { self.delete_provider_key(&provider, index); }
    }

    fn ui_models(&mut self, ui: &mut egui::Ui) {
        let free_count = self.models.iter().filter(|m| {
            m["pricing"]["input_per_1m"].as_f64().unwrap_or(1.0) == 0.0
                && m["pricing"]["output_per_1m"].as_f64().unwrap_or(1.0) == 0.0
                && m["price_per_request"].as_f64().unwrap_or(0.0) == 0.0
        }).count();
        let image_count = self.models.iter().filter(|m| m["capabilities"]["image"].as_bool().unwrap_or(false)).count();
        let video_count = self.models.iter().filter(|m| m["capabilities"]["video"].as_bool().unwrap_or(false)).count();
        ui.horizontal(|ui| {
            ui.vertical(|ui| {
                ui.label(egui::RichText::new("Model catalogue").size(22.0).strong().color(TEXT));
                ui.label(egui::RichText::new("Every field is editable. Saving writes to the live backend and hot-reloads the catalogue.")
                    .size(12.0).color(MUTED));
            });
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("Refresh").clicked() { self.refresh(); }
                if ui.button("+ New model").clicked() { self.model_form = ModelForm::default(); }
            });
        });
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            pill(ui, &format!("{} MODELS", self.models.len()), CYAN);
            pill(ui, &format!("{} FREE", free_count), GREEN);
            pill(ui, &format!("{} IMAGE", image_count), ACCENT);
            pill(ui, &format!("{} VIDEO", video_count), AMBER);
            ui.add_space(10.0);
            ui.add(egui::TextEdit::singleline(&mut self.model_search).hint_text("Search model, ID or provider…").desired_width(300.0));
        });
        ui.add_space(10.0);
        let mut edit_request: Option<Value> = None;
        let mut delete_request: Option<String> = None;
        egui::Frame::group(ui.style())
            .fill(CARD)
            .stroke(egui::Stroke::new(1.0, LINE))
            .inner_margin(14.0)
            .show(ui, |ui| {
                egui::ScrollArea::horizontal().show(ui, |ui| {
                    egui::Grid::new("models-grid")
                        .striped(true)
                        .num_columns(7)
                        .min_col_width(76.0)
                        .spacing([16.0, 11.0])
                        .show(ui, |ui| {
                            for h in ["Model", "API ID / Upstream", "Price in / out", "Type", "Capabilities", "Status", ""] {
                                ui.label(egui::RichText::new(h).size(10.0).strong().color(MUTED));
                            }
                            ui.end_row();
                            let needle = self.model_search.to_lowercase();
                            for m in self.models.clone() {
                                let id = m["id"].as_str().unwrap_or("").to_string();
                                let name = m["name"].as_str().unwrap_or("").to_string();
                                let provider = m["owned_by"].as_str().unwrap_or("").to_string();
                                let upstream = m["upstream"].as_str().unwrap_or("");
                                if !needle.is_empty()
                                    && !id.to_lowercase().contains(&needle)
                                    && !name.to_lowercase().contains(&needle)
                                    && !provider.to_lowercase().contains(&needle)
                                { continue; }
                                ui.vertical(|ui| {
                                    ui.label(egui::RichText::new(&name).color(TEXT).strong());
                                    ui.label(egui::RichText::new(&provider).size(10.0).color(MUTED));
                                });
                                ui.vertical(|ui| {
                                    ui.monospace(egui::RichText::new(&id).size(11.0).color(CYAN));
                                    ui.label(egui::RichText::new(if upstream.is_empty() { "—" } else { upstream }).size(10.0).color(MUTED));
                                    if let Some(url) = provider_link(upstream) {
                                        ui.hyperlink_to("Provider ↗", url);
                                    }
                                });
                                ui.vertical(|ui| {
                                    let request_price = m["price_per_request"].as_f64().unwrap_or(0.0);
                                    if request_price > 0.0 {
                                        ui.monospace(format!("${:.2} / req", request_price));
                                        ui.monospace(egui::RichText::new("—").color(MUTED));
                                    } else {
                                        ui.monospace(money(m["pricing"]["input_per_1m"].as_f64().unwrap_or(0.0)));
                                        ui.monospace(egui::RichText::new(money(m["pricing"]["output_per_1m"].as_f64().unwrap_or(0.0))).color(MUTED));
                                    }
                                });
                                ui.label(m["category"].as_str().unwrap_or("chat"));
                                ui.horizontal(|ui| {
                                    if m["pricing"]["input_per_1m"].as_f64().unwrap_or(1.0) == 0.0
                                        && m["pricing"]["output_per_1m"].as_f64().unwrap_or(1.0) == 0.0
                                        && m["price_per_request"].as_f64().unwrap_or(0.0) == 0.0 {
                                        pill(ui, "FREE", GREEN);
                                    }
                                    if m["capabilities"]["image"].as_bool().unwrap_or(false) { pill(ui, "IMG", ACCENT); }
                                    if m["capabilities"]["video"].as_bool().unwrap_or(false) { pill(ui, "VID", AMBER); }
                                });
                                if m["is_custom"].as_bool().unwrap_or(false) {
                                    pill(ui, "CUSTOM", CYAN);
                                } else {
                                    ui.label(egui::RichText::new("base").size(10.0).color(MUTED));
                                }
                                ui.horizontal(|ui| {
                                    if ui.small_button("Edit").clicked() { edit_request = Some(m.clone()); }
                                    if ui.small_button("Remove").clicked() { delete_request = Some(id.clone()); }
                                });
                                ui.end_row();
                            }
                        });
                });
            });
        if let Some(m) = edit_request {
            let id = m["id"].as_str().unwrap_or("").to_string();
            self.model_form = ModelForm {
                id: id.clone(),
                name: m["name"].as_str().unwrap_or("").to_string(),
                provider: m["owned_by"].as_str().unwrap_or("").to_string(),
                context: m["context"].as_str().unwrap_or("—").to_string(),
                speed: m["speed_tps"].as_f64().unwrap_or(0.0),
                input: m["pricing"]["input_per_1m"].as_f64().unwrap_or(0.0),
                output: m["pricing"]["output_per_1m"].as_f64().unwrap_or(0.0),
                price_per_request: m["price_per_request"].as_f64().unwrap_or(0.0),
                category: m["category"].as_str().unwrap_or("chat").to_string(),
                upstream: m["upstream"].as_str().unwrap_or("").to_string(),
                upstream_id: m["upstream_id"].as_str().unwrap_or("").to_string(),
                tag: m["tag"].as_str().unwrap_or("").to_string(),
                note: m["note"].as_str().unwrap_or("").to_string(),
                price_unit: m["price_unit"].as_str().unwrap_or("").to_string(),
                image: m["capabilities"]["image"].as_bool().unwrap_or(false),
                video: m["capabilities"]["video"].as_bool().unwrap_or(false),
            };
            self.status = format!("Editing {id}. Save writes the live override.");
        }
        if let Some(id) = delete_request {
            self.delete_custom_model(&id, false);
        }
        ui.add_space(14.0);
        egui::Frame::group(ui.style())
            .fill(CARD)
            .stroke(egui::Stroke::new(1.0, LINE))
            .inner_margin(18.0)
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label(egui::RichText::new("Model editor").size(17.0).strong().color(TEXT));
                    if self.model_form.id.is_empty() {
                        pill(ui, "NEW", CYAN);
                    } else {
                        pill(ui, &self.model_form.id.to_uppercase(), ACCENT);
                    }
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.button("Clear").clicked() { self.model_form = ModelForm::default(); }
                    });
                });
                ui.add_space(8.0);
                egui::Grid::new("model-form").num_columns(4).spacing([18.0, 9.0]).show(ui, |ui| {
                    field_label(ui, "Public model ID");
                    ui.add(egui::TextEdit::singleline(&mut self.model_form.id).desired_width(230.0).hint_text("my-model-id"));
                    field_label(ui, "Display name");
                    ui.add(egui::TextEdit::singleline(&mut self.model_form.name).desired_width(230.0));
                    ui.end_row();
                    field_label(ui, "Vendor");
                    ui.add(egui::TextEdit::singleline(&mut self.model_form.provider).desired_width(230.0).hint_text("OpenAI"));
                    field_label(ui, "Context");
                    ui.add(egui::TextEdit::singleline(&mut self.model_form.context).desired_width(230.0).hint_text("1M"));
                    ui.end_row();
                    field_label(ui, "Category");
                    egui::ComboBox::from_id_salt("model-category")
                        .width(230.0)
                        .selected_text(&self.model_form.category)
                        .show_ui(ui, |ui| {
                            for c in ["chat", "code", "tts", "moderation", "decision"] {
                                ui.selectable_value(&mut self.model_form.category, c.to_string(), c);
                            }
                        });
                    field_label(ui, "Upstream provider");
                    egui::ComboBox::from_id_salt("model-upstream")
                        .width(230.0)
                        .selected_text(if self.model_form.upstream.is_empty() { "choose…" } else { &self.model_form.upstream })
                        .show_ui(ui, |ui| {
                            for (id, title) in PROVIDERS {
                                ui.selectable_value(&mut self.model_form.upstream, id.to_string(), title);
                            }
                        });
                    if let Some(url) = provider_link(&self.model_form.upstream) {
                        ui.hyperlink_to("Open provider page ↗", url);
                    }
                    ui.end_row();
                    field_label(ui, "Upstream model ID");
                    ui.add(egui::TextEdit::singleline(&mut self.model_form.upstream_id).desired_width(230.0).hint_text("provider's exact ID"));
                    field_label(ui, "Tag");
                    ui.add(egui::TextEdit::singleline(&mut self.model_form.tag).desired_width(230.0).hint_text("New / Free / Popular"));
                    ui.end_row();
                    field_label(ui, "Input / 1M");
                    ui.add(egui::DragValue::new(&mut self.model_form.input).speed(0.001).range(0.0..=1000.0));
                    field_label(ui, "Output / 1M");
                    ui.add(egui::DragValue::new(&mut self.model_form.output).speed(0.001).range(0.0..=1000.0));
                    ui.end_row();
                    field_label(ui, "Price / request");
                    ui.add(egui::DragValue::new(&mut self.model_form.price_per_request).speed(0.001).range(0.0..=1000.0).prefix("$"));
                    field_label(ui, "Price unit");
                    ui.add(egui::TextEdit::singleline(&mut self.model_form.price_unit).desired_width(230.0).hint_text("1k_chars or request"));
                    ui.end_row();
                    field_label(ui, "Speed tok/s");
                    ui.add(egui::DragValue::new(&mut self.model_form.speed).speed(1.0).range(0.0..=10000.0));
                    ui.end_row();
                    field_label(ui, "Note");
                    ui.add(egui::TextEdit::singleline(&mut self.model_form.note).desired_width(520.0).hint_text("Customer-facing note"));
                    field_label(ui, "Capabilities");
                    ui.horizontal(|ui| {
                        ui.checkbox(&mut self.model_form.image, "Image input");
                        ui.checkbox(&mut self.model_form.video, "Video input");
                    });
                    ui.end_row();
                });
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    if ui.button("Save live model").clicked() { self.save_custom_model(); }
                    if !self.model_form.id.is_empty() {
                        if ui.button("Remove from catalogue").clicked() {
                            let id = self.model_form.id.clone();
                            self.delete_custom_model(&id, false);
                        }
                        if ui.button("Reset base").clicked() {
                            let id = self.model_form.id.clone();
                            self.delete_custom_model(&id, true);
                        }
                    }
                });
                if !self.hidden_models.is_empty() {
                    ui.add_space(10.0);
                    ui.label(egui::RichText::new("Hidden models").size(12.0).color(MUTED));
                    let hidden = self.hidden_models.clone();
                    for m in hidden {
                        let id = m["id"].as_str().unwrap_or("").to_string();
                        ui.horizontal(|ui| {
                            ui.monospace(&id);
                            ui.label(egui::RichText::new("hidden from catalogue").size(10.0).color(AMBER));
                            if ui.small_button("Restore").clicked() {
                                self.delete_custom_model(&id, true);
                            }
                        });
                    }
                }
                if !self.custom_models.is_empty() {
                    ui.add_space(10.0);
                    ui.label(egui::RichText::new("Live overrides").size(12.0).color(MUTED));
                    let overrides = self.custom_models.clone();
                    for m in overrides {
                        if m.get("hidden").and_then(Value::as_bool).unwrap_or(false) { continue; }
                        let id = m["id"].as_str().unwrap_or("").to_string();
                        ui.horizontal(|ui| {
                            ui.monospace(&id);
                            ui.label(m["name"].as_str().unwrap_or(""));
                            if ui.small_button("Load").clicked() {
                                self.model_form = model_form_from(&m);
                            }
                            if ui.small_button("Reset").clicked() {
                                self.delete_custom_model(&id, true);
                            }
                        });
                    }
                }
            });
    }

    fn ui_payments(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.vertical(|ui| {
                ui.label(egui::RichText::new("Payments").size(22.0).strong().color(TEXT));
                ui.label(egui::RichText::new("Real PayPal captures, bank webhook credits and customer transactions.")
                    .size(12.0).color(MUTED));
            });
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("Refresh").clicked() { self.refresh(); }
            });
        });
        ui.add_space(10.0);
        ui.horizontal_wrapped(|ui| {
            stat_card(ui, "REVENUE", &money(num(&self.overview, "revenue")), "top-ups + subscriptions", GREEN);
            stat_card(ui, "TRANSACTIONS", &self.transactions.len().to_string(), "recent ledger rows", CYAN);
            stat_card(ui, "PAYPAL ORDERS", &obj_len(&self.paypal_orders).to_string(), "live orders", ACCENT);
            stat_card(ui, "BANK EVENTS", &obj_len(&self.bank_txns).to_string(), "webhook rows", AMBER);
        });
        ui.add_space(12.0);
        egui::Frame::group(ui.style())
            .fill(CARD)
            .stroke(egui::Stroke::new(1.0, LINE))
            .inner_margin(14.0)
            .show(ui, |ui| {
                ui.label(egui::RichText::new("Transaction ledger").size(14.0).strong().color(TEXT));
                ui.add_space(6.0);
                egui::ScrollArea::horizontal().show(ui, |ui| {
                    egui::Grid::new("tx-grid").striped(true).num_columns(5).min_col_width(90.0).spacing([18.0, 9.0]).show(ui, |ui| {
                        for h in ["Date", "Account", "Description", "Method", "Amount"] {
                            ui.label(egui::RichText::new(h).size(10.0).strong().color(MUTED));
                        }
                        ui.end_row();
                        for t in &self.transactions {
                            ui.label(date_ts(t["ts"].as_i64().unwrap_or(0)));
                            ui.monospace(egui::RichText::new(t["email"].as_str().unwrap_or("")).size(11.0));
                            ui.label(t["description"].as_str().unwrap_or(""));
                            ui.label(t["method"].as_str().unwrap_or(""));
                            let amount = t["amount"].as_f64().unwrap_or(0.0);
                            ui.colored_label(if amount > 0.0 { GREEN } else { TEXT }, money(amount));
                            ui.end_row();
                        }
                    });
                });
                if self.transactions.is_empty() {
                    ui.add_space(6.0);
                    ui.label(egui::RichText::new("No transactions yet.").size(12.0).color(MUTED));
                }
            });
    }

    fn ui_settings(&mut self, ui: &mut egui::Ui) {
        ui.label(egui::RichText::new("Settings").size(22.0).strong().color(TEXT));
        ui.label(egui::RichText::new("Connect to the live backend and manage the admin session.").size(12.0).color(MUTED));
        ui.add_space(12.0);
        egui::Frame::group(ui.style())
            .fill(CARD)
            .stroke(egui::Stroke::new(1.0, LINE))
            .inner_margin(18.0)
            .show(ui, |ui| {
                ui.label(egui::RichText::new("Live backend").size(14.0).strong().color(TEXT));
                ui.add_space(8.0);
                egui::Grid::new("settings-grid").num_columns(2).spacing([18.0, 9.0]).show(ui, |ui| {
                    field_label(ui, "Backend URL");
                    ui.add(egui::TextEdit::singleline(&mut self.cfg.backend_url).desired_width(420.0)); ui.end_row();
                    field_label(ui, "Admin email");
                    ui.add(egui::TextEdit::singleline(&mut self.cfg.admin_email).desired_width(420.0)); ui.end_row();
                    field_label(ui, "Admin password");
                    ui.add(egui::TextEdit::singleline(&mut self.cfg.admin_password).password(true).desired_width(420.0)); ui.end_row();
                });
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    if ui.button("Save & reconnect").clicked() { self.save_config(); }
                    if ui.button("Test connection").clicked() { self.api_key.clear(); self.refresh(); }
                    if ui.button("Open storefront").clicked() { open_url(&self.backend()); }
                    if ui.button("Open web admin").clicked() { open_url(&format!("{}/admin.html", self.backend())); }
                });
                ui.label(egui::RichText::new(format!("Config: {}", self.cfg_path.display())).size(9.5).color(MUTED));
            });
        ui.add_space(12.0);
        egui::Frame::group(ui.style())
            .fill(CARD)
            .stroke(egui::Stroke::new(1.0, LINE))
            .inner_margin(18.0)
            .show(ui, |ui| {
                ui.label(egui::RichText::new("Live sync").size(14.0).strong().color(TEXT));
                ui.add_space(4.0);
                ui.label(egui::RichText::new("Provider keys and model edits are sent to /api/admin/* on the live backend. The gateway reads keys per request and hot-reloads the model catalogue, so changes go live immediately — no redeploy and no restart.")
                    .size(11.0).color(MUTED));
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    pill(ui, "KEYS LIVE", GREEN);
                    pill(ui, "MODELS HOT-RELOAD", GREEN);
                    pill(ui, "NO DEPLOY", CYAN);
                });
            });
        ui.add_space(12.0);
        egui::Frame::group(ui.style())
            .fill(CARD)
            .stroke(egui::Stroke::new(1.0, LINE))
            .inner_margin(18.0)
            .show(ui, |ui| {
                ui.label(egui::RichText::new("Admin account").size(14.0).strong().color(TEXT));
                ui.add_space(4.0);
                ui.monospace(egui::RichText::new(&self.cfg.admin_email).color(CYAN));
                ui.label(egui::RichText::new("The password is stored in console_config.json next to the executable. Use the same account on /admin.html.")
                    .size(10.0).color(MUTED));
                if ui.button("Copy admin email").clicked() {
                    ui.ctx().copy_text(self.cfg.admin_email.clone());
                }
            });
    }
}

fn model_form_from(m: &Value) -> ModelForm {
    ModelForm {
        id: m["id"].as_str().unwrap_or("").to_string(),
        name: m["name"].as_str().unwrap_or("").to_string(),
        provider: m["provider"].as_str().unwrap_or("").to_string(),
        context: m["context"].as_str().unwrap_or("—").to_string(),
        speed: m["speed"].as_f64().unwrap_or(0.0),
        input: m["input"].as_f64().unwrap_or(0.0),
        output: m["output"].as_f64().unwrap_or(0.0),
        price_per_request: m["price_per_request"].as_f64().unwrap_or(0.0),
        category: m["category"].as_str().unwrap_or("chat").to_string(),
        upstream: m["upstream"].as_str().unwrap_or("").to_string(),
        upstream_id: m["upstream_id"].as_str().unwrap_or("").to_string(),
        tag: m["tag"].as_str().unwrap_or("").to_string(),
        note: m["note"].as_str().unwrap_or("").to_string(),
        price_unit: m["price_unit"].as_str().unwrap_or("").to_string(),
        image: m["image"].as_bool().unwrap_or(false),
        video: m["video"].as_bool().unwrap_or(false),
    }
}

fn field_label(ui: &mut egui::Ui, text: &str) {
    ui.label(egui::RichText::new(text).size(11.0).color(MUTED));
}

fn nav_item(ui: &mut egui::Ui, selected: bool, icon: &str, label: &str) -> bool {
    let fill = if selected { CARD } else { PANEL };
    let stroke = if selected {
        egui::Stroke::new(1.0, egui::Color32::from_rgba_unmultiplied(ACCENT.r(), ACCENT.g(), ACCENT.b(), 110))
    } else {
        egui::Stroke::NONE
    };
    let response = egui::Frame::new()
        .fill(fill)
        .stroke(stroke)
        .corner_radius(egui::CornerRadius::same(9))
        .inner_margin(egui::Margin::symmetric(11, 9))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.label(egui::RichText::new(icon).size(14.0).color(if selected { ACCENT } else { MUTED }));
                ui.add_space(4.0);
                ui.label(
                    egui::RichText::new(label)
                        .size(13.0)
                        .strong()
                        .color(if selected { TEXT } else { MUTED }),
                );
            });
        })
        .response;
    response.interact(egui::Sense::click()).clicked()
}

fn pill(ui: &mut egui::Ui, text: &str, color: egui::Color32) {
    egui::Frame::new()
        .fill(egui::Color32::from_rgba_unmultiplied(color.r(), color.g(), color.b(), 22))
        .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgba_unmultiplied(color.r(), color.g(), color.b(), 80)))
        .corner_radius(egui::CornerRadius::same(9))
        .inner_margin(egui::Margin::symmetric(7, 3))
        .show(ui, |ui| {
            ui.label(egui::RichText::new(text).size(9.5).strong().color(color));
        });
}

fn setup_style(ctx: &egui::Context) {
    let mut visuals = egui::Visuals::dark();
    visuals.panel_fill = BG;
    visuals.window_fill = PANEL;
    visuals.extreme_bg_color = CARD_HI;
    visuals.faint_bg_color = CARD;
    visuals.override_text_color = Some(TEXT);
    visuals.window_stroke = egui::Stroke::new(1.0, LINE);
    visuals.window_corner_radius = egui::CornerRadius::same(12);
    visuals.menu_corner_radius = egui::CornerRadius::same(10);
    visuals.widgets.noninteractive.bg_fill = PANEL;
    visuals.widgets.noninteractive.bg_stroke = egui::Stroke::new(1.0, LINE);
    visuals.widgets.inactive.bg_fill = CARD;
    visuals.widgets.inactive.weak_bg_fill = CARD;
    visuals.widgets.hovered.bg_fill = CARD_HI;
    visuals.widgets.hovered.weak_bg_fill = CARD_HI;
    visuals.widgets.active.bg_fill = egui::Color32::from_rgb(36, 30, 70);
    visuals.selection.bg_fill = egui::Color32::from_rgb(76, 51, 132);
    ctx.set_visuals(visuals);

    let mut style = (*ctx.style()).clone();
    style.spacing.item_spacing = egui::vec2(12.0, 10.0);
    style.spacing.button_padding = egui::vec2(14.0, 7.0);
    style.spacing.interact_size.y = 30.0;
    style.visuals.widgets.noninteractive.corner_radius = egui::CornerRadius::same(10);
    style.visuals.widgets.inactive.corner_radius = egui::CornerRadius::same(8);
    style.visuals.widgets.hovered.corner_radius = egui::CornerRadius::same(8);
    style.visuals.widgets.active.corner_radius = egui::CornerRadius::same(8);
    style.text_styles.insert(egui::TextStyle::Heading, egui::FontId::proportional(24.0));
    style.text_styles.insert(egui::TextStyle::Body, egui::FontId::proportional(13.0));
    style.text_styles.insert(egui::TextStyle::Button, egui::FontId::proportional(13.0));
    style.text_styles.insert(egui::TextStyle::Small, egui::FontId::proportional(10.0));
    ctx.set_style(style);

    let mut fonts = egui::FontDefinitions::default();
    if let Ok(bytes) = fs::read("C:\\Windows\\Fonts\\segoeui.ttf") {
        fonts
            .font_data
            .insert("segoe".to_owned(), egui::FontData::from_owned(bytes).into());
        fonts
            .families
            .entry(egui::FontFamily::Proportional)
            .or_default()
            .insert(0, "segoe".to_owned());
    }
    if let Ok(bytes) = fs::read("C:\\Windows\\Fonts\\consola.ttf") {
        fonts
            .font_data
            .insert("consolas".to_owned(), egui::FontData::from_owned(bytes).into());
        fonts
            .families
            .entry(egui::FontFamily::Monospace)
            .or_default()
            .insert(0, "consolas".to_owned());
    }
    ctx.set_fonts(fonts);
}

fn card(ui: &mut egui::Ui, add: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::group(ui.style())
        .fill(CARD)
        .stroke(egui::Stroke::new(1.0, LINE))
        .inner_margin(16.0)
        .show(ui, add);
}

fn stat_card(ui: &mut egui::Ui, label: &str, value: &str, note: &str, color: egui::Color32) {
    egui::Frame::new()
        .fill(CARD)
        .stroke(egui::Stroke::new(1.0, LINE))
        .corner_radius(egui::CornerRadius::same(12))
        .inner_margin(16.0)
        .show(ui, |ui| {
            ui.set_min_width(196.0);
            ui.set_min_height(78.0);
            ui.horizontal(|ui| {
                ui.label(egui::RichText::new("●").size(9.0).color(color));
                ui.label(egui::RichText::new(label).size(9.5).strong().color(MUTED));
            });
            ui.add_space(2.0);
            ui.label(egui::RichText::new(value).size(26.0).strong().color(color));
            ui.label(egui::RichText::new(note).size(9.5).color(MUTED));
        });
}

fn config_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("console_config.json")
}

fn load_config(path: &Path) -> Config {
    if let Ok(s) = fs::read_to_string(path) {
        if let Ok(cfg) = serde_json::from_str::<Config>(&s) {
            return cfg;
        }
    }
    let cfg = Config::default();
    let _ = write_json(path, &serde_json::to_value(&cfg).unwrap_or(Value::Null));
    cfg
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn read_key_file(path: &Path) -> Vec<String> {
    let Ok(s) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(v) = serde_json::from_str::<Value>(&s) else {
        return Vec::new();
    };
    let Some(arr) = v.as_array() else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| {
            item.as_str()
                .map(str::to_string)
                .or_else(|| item["api_key"].as_str().map(str::to_string))
        })
        .collect()
}

fn mask_key(key: &str) -> String {
    if key.len() <= 12 {
        return "••••".to_string();
    }
    format!("{}…{}", &key[..8], &key[key.len() - 4..])
}

fn num(v: &Value, key: &str) -> f64 {
    v[key].as_f64().or_else(|| v[key].as_i64().map(|i| i as f64)).unwrap_or(0.0)
}

fn money(v: f64) -> String {
    format!("${:.2}", v)
}

fn short_num(v: f64) -> String {
    if v >= 1_000_000.0 {
        format!("{:.1}M", v / 1_000_000.0)
    } else if v >= 1_000.0 {
        format!("{:.1}K", v / 1_000.0)
    } else {
        format!("{}", v as i64)
    }
}

fn plan_label(plan: &str) -> String {
    match plan {
        "starter" => "Starter".to_string(),
        "pro" => "Pro".to_string(),
        "ultra" => "Ultra".to_string(),
        _ => "Pay-as-you-go".to_string(),
    }
}

fn time_ago(ts: i64) -> String {
    if ts <= 0 {
        return "Never".to_string();
    }
    let now = chrono::Utc::now().timestamp();
    let mins = ((now - ts).max(0) / 60) as i64;
    if mins < 1 {
        "Just now".to_string()
    } else if mins < 60 {
        format!("{mins} min ago")
    } else if mins < 1440 {
        format!("{}h ago", mins / 60)
    } else {
        format!("{}d ago", mins / 1440)
    }
}

fn date_ts(ts: i64) -> String {
    if ts <= 0 {
        return "—".to_string();
    }
    chrono::DateTime::from_timestamp(ts, 0)
        .map(|d| d.format("%b %d").to_string())
        .unwrap_or_else(|| "—".to_string())
}

fn obj_len(v: &Value) -> usize {
    v.as_object()
        .map(|o| o.len())
        .or_else(|| v.as_array().map(|a| a.len()))
        .unwrap_or(0)
}

fn open_url(url: &str) {
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn();
}

fn open_folder(path: &str) {
    let _ = std::process::Command::new("explorer").arg(path).spawn();
}

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1280.0, 820.0])
            .with_min_inner_size([980.0, 640.0]),
        ..Default::default()
    };
    eframe::run_native(
        "NovaCompute Admin",
        options,
        Box::new(|cc| Ok(Box::new(App::new(cc)))),
    )
}
