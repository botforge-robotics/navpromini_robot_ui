# NavPro Mini - Robot Touchscreen UI App

A dedicated Flutter touch-kiosk interface designed specifically for the physical display of the **NavPro Mini** autonomous mobile robot.

Distinct from the desktop mission planner studio, this application runs directly on the robot's local display (Raspberry Pi 5 / touchscreen) or can be accessed via local kiosk browser. It connects directly to the local Python SDK daemon at `http://127.0.0.1:8090` to provide physical touch controls, mission execution, saved locations management, and automated **Human-In-The-Loop (HITL)** interactive dialogs.

---

## 🌟 Key Features

### 1. 🔋 Live Battery & Power Monitoring
- Real-time battery voltage, percentage, current, and charging status indicators.
- Animated battery charging pulses and color-coded status warnings (Critical <20%, Low <30%, Good >50%).

### 2. ⚡ Actuators & Robot Controls
- **Auto-Dock**: One-touch automated docking to charging station.
- **Undock**: Safe undock procedure.
- **Emergency Stop**: High-contrast, immediate soft/hardware emergency stop button.

### 3. 📍 Saved Locations & Instant Navigation
- Visual grid of all saved waypoints on the active map.
- 1-tap "Navigate Here" action with active progress tracking and cancel option.
- View exact coordinates `(X, Y, Yaw)` for any saved location.

### 4. 📌 "Save Current Location" Dialog
- Captures current robot odometry/AMCL pose `(x, y, theta)` with one tap.
- Customizable location name, category (Desk, Charging, Room, Checkpoint, etc.), and optional tags.
- Immediately registers the location with the robot's waypoint manager.

### 5. 🚀 Missions Control Center
- Browse all saved missions (linear waypoint missions and visual decision-graph missions).
- Execute missions directly from the touchscreen.
- Abort / cancel active missions at any time.

### 6. 🤝 Dynamic Human-In-The-Loop (HITL) Kiosk Overlay
When an executing mission hits a **User Interaction Node** (`ui_interaction`), the app automatically detects the `waiting_for_user` state and presents a full-screen, high-priority touch interface:
- **Alert / Information Dialogs**: Displays critical messages, instructions, or confirmations.
- **Action Choice Buttons**: Quick buttons with custom labels (e.g. `[Approve]`, `[Reject]`, `[Inspect]`) which branch the mission graph dynamically.
- **Dynamic Form Inputs**: Touch-friendly form fields (text, numbers, booleans, dropdowns) generated from the graph mission's form schema.
- **Kiosk Waypoint Picker**: Allows the human standing at the robot to choose the robot's next destination from a list of waypoints.
- **Timeout Countdown**: Animated circular countdown bar when node has a configured timeout, executing the timeout branch automatically.

---

## 🏗️ Architecture & File Structure

```
navpromini_robot_ui/
├── lib/
│   ├── main.dart                      # Application entry point
│   ├── config/
│   │   └── app_theme.dart             # Touchscreen-optimized high-contrast dark theme
│   ├── models/
│   │   ├── battery_info.dart          # Battery & power telemetry model
│   │   ├── waypoint.dart              # Pose & waypoint model
│   │   ├── mission.dart               # Mission execution & status model
│   │   └── ui_interaction.dart        # Dynamic kiosk UI payload & response model
│   ├── services/
│   │   └── robot_api_service.dart     # HTTP client for http://127.0.0.1:8090
│   ├── widgets/
│   │   ├── battery_indicator.dart     # Dynamic battery gauge & voltage chips
│   │   ├── save_location_dialog.dart  # Modal for saving current robot pose
│   │   └── interactive_ui_overlay.dart# Fullscreen HITL dynamic interactive kiosk modal
│   └── screens/
│       ├── main_kiosk_shell.dart      # Root kiosk shell with navigation rail & UI trigger
│       ├── home_dashboard_screen.dart # Home dashboard (status, actuators, quick actions)
│       ├── saved_locations_screen.dart# Saved waypoints grid & 1-tap navigation
│       └── missions_control_screen.dart# Mission runner, monitor & abort control
├── test/
│   └── widget_test.dart               # Kiosk smoke & mount tests
├── pubspec.yaml                       # Dependencies: http, intl, web_socket_channel
└── README.md
```

---

## 🚀 Running & Developing

### Local Development (Host Machine)
Run the application locally pointing to the physical robot's SDK endpoint:
```bash
cd /home/chaitu/Projects/navpromini_robot_ui
flutter run -d linux
```
Or run in Chrome for web preview:
```bash
flutter run -d chrome
```

### Testing
Run the test suite and static analysis:
```bash
flutter test
flutter analyze
```

---

## 🖥️ Deployment on Robot Display

### Option A: Web Kiosk via Chromium (Recommended for Pi touchscreen)
1. Build the production web bundle:
   ```bash
   flutter build web --release --base-href "/"
   ```
2. Serve the static build with a lightweight web server (e.g. `python3 -m http.server 8080 --directory build/web` or Nginx).
3. Launch Chromium in kiosk mode on display `:0`:
   ```bash
   chromium-browser --kiosk --incognito --noerrdialogs --disable-infobars http://127.0.0.1:8080
   ```

### Option B: Native Linux Binary
Build and execute directly on the Raspberry Pi:
```bash
flutter build linux --release
./build/linux/arm64/release/bundle/navpromini_robot_ui
```
