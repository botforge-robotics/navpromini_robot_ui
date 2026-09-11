class RobotMission {
  RobotMission({
    required this.id,
    required this.name,
    this.type = 'linear',
    this.map,
    this.stepCount = 0,
    this.nodeCount = 0,
  });

  final String id;
  final String name;
  final String type; // 'linear' or 'graph'
  final String? map;
  final int stepCount;
  final int nodeCount;

  bool get isGraph => type == 'graph' || nodeCount > 0;

  factory RobotMission.fromJson(Map<String, dynamic> json) {
    final nodes = (json['nodes'] as List?) ?? [];
    final steps = (json['steps'] as List?) ?? [];
    final rawType = json['type']?.toString() ?? (nodes.isNotEmpty ? 'graph' : 'linear');

    return RobotMission(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? json['id']?.toString() ?? 'Untitled',
      type: rawType,
      map: json['map']?.toString(),
      stepCount: steps.length,
      nodeCount: nodes.length,
    );
  }
}

class MissionStatus {
  MissionStatus({
    required this.state, // 'idle', 'running', 'waiting_for_user', 'paused', 'completed', 'failed'
    this.missionId,
    this.activeNodeId,
    this.activeNodeType,
    this.stepIndex,
    this.message,
    this.elapsedSec = 0.0,
  });

  final String state;
  final String? missionId;
  final String? activeNodeId;
  final String? activeNodeType;
  final int? stepIndex;
  final String? message;
  final double elapsedSec;

  bool get isRunning => state == 'running' || state == 'paused' || state == 'waiting_for_user';
  bool get isWaitingForUser => state == 'waiting_for_user';

  factory MissionStatus.fromJson(Map<String, dynamic> json) {
    return MissionStatus(
      state: json['state']?.toString() ?? 'idle',
      missionId: json['mission_id']?.toString(),
      activeNodeId: json['active_node_id']?.toString(),
      activeNodeType: json['active_node_type']?.toString(),
      stepIndex: json['step_index'] as int?,
      message: json['message']?.toString(),
      elapsedSec: (json['elapsed_sec'] as num?)?.toDouble() ?? 0.0,
    );
  }
}
