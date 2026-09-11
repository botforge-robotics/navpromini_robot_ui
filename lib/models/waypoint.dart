class Waypoint {
  Waypoint({
    required this.name,
    required this.x,
    required this.y,
    this.theta = 0.0,
    this.map,
  });

  final String name;
  final double x;
  final double y;
  final double theta;
  final String? map;

  factory Waypoint.fromJson(Map<String, dynamic> json) {
    return Waypoint(
      name: json['name']?.toString() ?? 'Unnamed',
      x: (json['x'] as num?)?.toDouble() ?? 0.0,
      y: (json['y'] as num?)?.toDouble() ?? 0.0,
      theta: (json['theta'] as num?)?.toDouble() ?? (json['yaw'] as num?)?.toDouble() ?? 0.0,
      map: json['map']?.toString(),
    );
  }

  Map<String, dynamic> toJson() => {
        'name': name,
        'x': x,
        'y': y,
        'theta': theta,
        if (map != null) 'map': map,
      };
}
