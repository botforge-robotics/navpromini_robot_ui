class BatteryInfo {
  BatteryInfo({
    required this.percentage,
    required this.voltage,
    required this.isCharging,
    this.currentA = 0.0,
    this.status = 'discharging',
  });

  final double percentage;
  final double voltage;
  final bool isCharging;
  final double currentA;
  final String status;

  factory BatteryInfo.fromJson(Map<String, dynamic> json) {
    final pct = (json['percentage'] as num?)?.toDouble() ?? 0.0;
    final volt = (json['voltage'] as num?)?.toDouble() ?? 0.0;
    final charging = json['is_charging'] == true ||
        json['charging'] == true ||
        (json['status']?.toString().toLowerCase().contains('charging') ?? false);
    final cur = (json['current'] as num?)?.toDouble() ?? 0.0;
    final stat = json['status']?.toString() ?? (charging ? 'Charging' : 'Normal');

    return BatteryInfo(
      percentage: pct,
      voltage: volt,
      isCharging: charging,
      currentA: cur,
      status: stat,
    );
  }
}
