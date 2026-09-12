import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../config/app_theme.dart';
import '../models/battery_info.dart';
import '../models/mission.dart';
import '../models/ui_interaction.dart';
import '../models/waypoint.dart';
import '../services/robot_api_service.dart';
import '../widgets/battery_indicator.dart';
import '../widgets/interactive_ui_overlay.dart';
import 'home_dashboard_screen.dart';
import 'missions_control_screen.dart';
import 'saved_locations_screen.dart';

class MainKioskShell extends StatefulWidget {
  const MainKioskShell({super.key});

  @override
  State<MainKioskShell> createState() => _MainKioskShellState();
}

class _MainKioskShellState extends State<MainKioskShell> {
  final RobotApiService _api = RobotApiService(baseUrl: 'http://127.0.0.1:8090');

  int _selectedTabIndex = 0;
  BatteryInfo _battery = BatteryInfo(percentage: 0.0, voltage: 0.0, isCharging: false);
  MissionStatus _missionStatus = MissionStatus(state: 'idle');
  List<Waypoint> _waypoints = [];
  List<RobotMission> _missions = [];
  String? _currentMap;
  bool _isConnected = false;

  UiInteractionModel? _activeInteraction;
  Timer? _pollerTimer;
  Timer? _clockTimer;
  StreamSubscription<UiInteractionModel?>? _interactionSub;
  String _currentTime = '';

  @override
  void initState() {
    super.initState();
    _updateClock();
    _clockTimer = Timer.periodic(const Duration(seconds: 1), (_) => _updateClock());
    _loadAllData();
    _interactionSub = _api.interactionStream.listen((inter) {
      if (mounted) {
        setState(() {
          _activeInteraction = inter;
        });
      }
    });
    _pollerTimer = Timer.periodic(const Duration(seconds: 2), (_) => _pollRobotState());
  }

  @override
  void dispose() {
    _clockTimer?.cancel();
    _pollerTimer?.cancel();
    _interactionSub?.cancel();
    _api.dispose();
    super.dispose();
  }

  void _updateClock() {
    setState(() {
      _currentTime = DateFormat('HH:mm:ss').format(DateTime.now());
    });
  }

  Future<void> _loadAllData() async {
    try {
      final bat = await _api.getBattery();
      final status = await _api.getMissionStatus();
      final wps = await _api.listWaypoints();
      final ms = await _api.listMissions();
      final map = await _api.getCurrentMap();

      if (mounted) {
        setState(() {
          _battery = bat;
          _missionStatus = status;
          _waypoints = wps;
          _missions = ms;
          _currentMap = map;
          _isConnected = true;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isConnected = false);
    }
  }

  Future<void> _pollRobotState() async {
    try {
      final bat = await _api.getBattery();
      final status = await _api.getMissionStatus();
      final inter = await _api.fetchActiveUiInteraction();

      if (mounted) {
        setState(() {
          _battery = bat;
          _missionStatus = status;
          _activeInteraction = inter;
          _isConnected = true;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isConnected = false);
    }
  }

  void _showSettingsDialog() {
    final controller = TextEditingController(text: _api.baseUrl);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: RobotTheme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: const Text('Robot Connection Settings'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Specify the local or remote robot SDK URL:',
              style: TextStyle(color: Colors.grey, fontSize: 13),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: controller,
              decoration: const InputDecoration(
                labelText: 'SDK Server Base URL',
                hintText: 'http://127.0.0.1:8090',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel', style: TextStyle(color: Colors.grey)),
          ),
          ElevatedButton(
            onPressed: () {
              setState(() {
                _api.baseUrl = controller.text.trim();
              });
              Navigator.of(ctx).pop();
              _loadAllData();
            },
            child: const Text('Connect'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          // Main App Column
          Column(
            children: [
              // Top Bar
              _buildTopBar(),

              // Selected Screen Body
              Expanded(
                child: IndexedStack(
                  index: _selectedTabIndex,
                  children: [
                    HomeDashboardScreen(
                      api: _api,
                      battery: _battery,
                      missionStatus: _missionStatus,
                      currentMap: _currentMap,
                      onRefresh: _loadAllData,
                      onNavigateToTab: (idx) => setState(() => _selectedTabIndex = idx),
                    ),
                    SavedLocationsScreen(
                      api: _api,
                      waypoints: _waypoints,
                      onRefresh: _loadAllData,
                    ),
                    MissionsControlScreen(
                      api: _api,
                      missions: _missions,
                      status: _missionStatus,
                      onRefresh: _loadAllData,
                    ),
                  ],
                ),
              ),

              // Bottom Navigation Bar
              _buildBottomNav(),
            ],
          ),

          // AUTOMATIC INTERACTIVE UI OVERLAY (Dynamic Human-in-the-Loop)
          if (_activeInteraction != null)
            InteractiveUiOverlay(
              interaction: _activeInteraction!,
              api: _api,
              onDismissed: () {
                setState(() => _activeInteraction = null);
                _loadAllData();
              },
            ),
        ],
      ),
    );
  }

  Widget _buildTopBar() {
    return Container(
      height: 64,
      padding: const EdgeInsets.symmetric(horizontal: 24),
      decoration: const BoxDecoration(
        color: RobotTheme.surface,
        border: Border(bottom: BorderSide(color: RobotTheme.border, width: 1.2)),
      ),
      child: Row(
        children: [
          // Robot Logo
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: RobotTheme.primary.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.smart_toy_rounded, color: RobotTheme.primary, size: 22),
          ),
          const SizedBox(width: 12),
          const Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'NAVPRO MINI',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 16,
                  letterSpacing: 1.0,
                ),
              ),
              Text(
                'TOUCHSCREEN INTERFACE',
                style: TextStyle(color: RobotTheme.primary, fontSize: 9, fontWeight: FontWeight.bold),
              ),
            ],
          ),

          const Spacer(),

          // Realtime Digital Clock
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.05),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              children: [
                const Icon(Icons.access_time_rounded, size: 16, color: Colors.grey),
                const SizedBox(width: 8),
                Text(
                  _currentTime,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 14,
                    fontFamily: 'monospace',
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 16),

          // Battery status chip
          BatteryIndicator(battery: _battery, compact: true),
          const SizedBox(width: 16),

          // Server Connection indicator / Settings button
          InkWell(
            onTap: _showSettingsDialog,
            borderRadius: BorderRadius.circular(10),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: (_isConnected ? RobotTheme.success : RobotTheme.danger).withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: (_isConnected ? RobotTheme.success : RobotTheme.danger).withValues(alpha: 0.4),
                ),
              ),
              child: Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: _isConnected ? RobotTheme.success : RobotTheme.danger,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    _isConnected ? 'ONLINE' : 'OFFLINE',
                    style: TextStyle(
                      color: _isConnected ? RobotTheme.success : RobotTheme.danger,
                      fontWeight: FontWeight.bold,
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomNav() {
    return Container(
      height: 72,
      decoration: const BoxDecoration(
        color: RobotTheme.surface,
        border: Border(top: BorderSide(color: RobotTheme.border, width: 1.2)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _buildNavItem(0, 'Dashboard', Icons.dashboard_rounded),
          _buildNavItem(1, 'Locations', Icons.place_rounded),
          _buildNavItem(2, 'Missions', Icons.route_rounded),
        ],
      ),
    );
  }

  Widget _buildNavItem(int index, String label, IconData icon) {
    final isSelected = _selectedTabIndex == index;
    final color = isSelected ? RobotTheme.primary : Colors.grey;

    return Expanded(
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            setState(() => _selectedTabIndex = index);
            _loadAllData();
          },
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: color, size: 26),
              const SizedBox(height: 4),
              Text(
                label,
                style: TextStyle(
                  color: color,
                  fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
