import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/battery_info.dart';
import '../models/mission.dart';
import '../models/ui_interaction.dart';
import '../models/waypoint.dart';

class RobotApiService {
  RobotApiService({this.baseUrl = 'http://127.0.0.1:8090'});

  String baseUrl;

  Uri _url(String endpoint) => Uri.parse('$baseUrl$endpoint');

  Future<dynamic> _get(String endpoint) async {
    final response = await http.get(_url(endpoint)).timeout(const Duration(seconds: 4));
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return jsonDecode(response.body);
    }
    throw Exception('GET $endpoint failed: ${response.statusCode} ${response.body}');
  }

  Future<dynamic> _post(String endpoint, [Map<String, dynamic>? body]) async {
    final response = await http
        .post(
          _url(endpoint),
          headers: {'Content-Type': 'application/json'},
          body: body != null ? jsonEncode(body) : null,
        )
        .timeout(const Duration(seconds: 8));
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return jsonDecode(response.body);
    }
    throw Exception('POST $endpoint failed: ${response.statusCode} ${response.body}');
  }

  // --- Battery & Power ---
  Future<BatteryInfo> getBattery() async {
    try {
      final res = await _get('/api/v1/power/battery');
      return BatteryInfo.fromJson(res);
    } catch (_) {
      // Fallback to system health
      try {
        final res = await _get('/api/v1/system/health');
        final bat = res['battery'] as Map<String, dynamic>? ?? {};
        return BatteryInfo.fromJson(bat);
      } catch (_) {
        return BatteryInfo(percentage: 0.0, voltage: 0.0, isCharging: false);
      }
    }
  }

  // --- Active Map ---
  Future<String?> getCurrentMap() async {
    try {
      final res = await _get('/api/v1/maps/current');
      return res['current']?.toString();
    } catch (_) {
      return null;
    }
  }

  // --- Current Robot Pose ---
  Future<Map<String, double>> getCurrentPose() async {
    try {
      final res = await _get('/api/v1/navigation/status');
      final pose = res['pose'] as Map<String, dynamic>? ?? {};
      return {
        'x': (pose['x'] as num?)?.toDouble() ?? 0.0,
        'y': (pose['y'] as num?)?.toDouble() ?? 0.0,
        'theta': (pose['theta'] as num?)?.toDouble() ?? (pose['yaw'] as num?)?.toDouble() ?? 0.0,
      };
    } catch (_) {
      return {'x': 0.0, 'y': 0.0, 'theta': 0.0};
    }
  }

  // --- Waypoints & Locations ---
  Future<List<Waypoint>> listWaypoints() async {
    try {
      final res = await _get('/api/v1/waypoints');
      final raw = res['waypoints'] as List? ?? [];
      return raw.whereType<Map<String, dynamic>>().map((w) => Waypoint.fromJson(w)).toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> saveCurrentLocationAsWaypoint(String name) async {
    final pose = await getCurrentPose();
    await _post('/api/v1/waypoints', {
      'name': name,
      'x': pose['x'],
      'y': pose['y'],
      'theta': pose['theta'],
    });
  }

  Future<void> navigateToWaypoint(String name) async {
    await _post('/api/v1/navigation/waypoint', {'name': name});
  }

  Future<void> cancelNavigation() async {
    await _post('/api/v1/navigation/cancel');
  }

  // --- Docking & Motion ---
  Future<void> dockRobot() async {
    await _post('/api/v1/dock/dock');
  }

  Future<void> undockRobot() async {
    await _post('/api/v1/dock/undock');
  }

  Future<void> stopMotion() async {
    await _post('/api/v1/motion/stop');
  }

  // --- Missions ---
  Future<List<RobotMission>> listMissions() async {
    try {
      final res = await _get('/api/v1/missions');
      final raw = res['missions'] as List? ?? [];
      return raw.whereType<Map<String, dynamic>>().map((m) => RobotMission.fromJson(m)).toList();
    } catch (_) {
      return [];
    }
  }

  Future<MissionStatus> getMissionStatus() async {
    try {
      final res = await _get('/api/v1/missions/status');
      return MissionStatus.fromJson(res);
    } catch (_) {
      return MissionStatus(state: 'idle');
    }
  }

  Future<void> startMission(String id) async {
    await _post('/api/v1/missions/$id/start');
  }

  Future<void> pauseMission(String id) async {
    await _post('/api/v1/missions/$id/pause');
  }

  Future<void> resumeMission(String id) async {
    await _post('/api/v1/missions/$id/resume');
  }

  Future<void> cancelMission(String id) async {
    await _post('/api/v1/missions/$id/cancel');
  }

  // --- Human-in-the-Loop Dynamic UI Interaction ---
  Future<UiInteractionModel?> fetchActiveUiInteraction() async {
    try {
      final res = await _get('/api/v1/missions/active_ui_interaction');
      final inter = res['active_interaction'] ?? res['interaction'];
      if (inter is Map<String, dynamic>) {
        return UiInteractionModel.fromJson(inter);
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<void> submitUiResponse({
    required String interactionId,
    required String action,
    String? selected,
    Map<String, dynamic>? formData,
  }) async {
    final body = <String, dynamic>{
      'interaction_id': interactionId,
      'action': action,
      'selected': ?selected,
      'form_data': ?formData,
    };
    await _post('/api/v1/missions/ui_response', body);
  }
}
