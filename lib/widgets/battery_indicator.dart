import 'package:flutter/material.dart';
import '../config/app_theme.dart';
import '../models/battery_info.dart';

class BatteryIndicator extends StatelessWidget {
  const BatteryIndicator({
    super.key,
    required this.battery,
    this.compact = false,
  });

  final BatteryInfo battery;
  final bool compact;

  Color get _color {
    if (battery.isCharging) return RobotTheme.primary;
    if (battery.percentage < 15) return RobotTheme.danger;
    if (battery.percentage < 35) return RobotTheme.warning;
    return RobotTheme.success;
  }

  @override
  Widget build(BuildContext context) {
    if (compact) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: _color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: _color.withValues(alpha: 0.4)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              battery.isCharging ? Icons.bolt_rounded : Icons.battery_charging_full_rounded,
              size: 16,
              color: _color,
            ),
            const SizedBox(width: 6),
            Text(
              '${battery.percentage.toStringAsFixed(0)}%',
              style: TextStyle(
                color: _color,
                fontWeight: FontWeight.bold,
                fontSize: 13,
              ),
            ),
          ],
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: RobotTheme.card,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: RobotTheme.border, width: 1.2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: _color.withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  battery.isCharging ? Icons.bolt_rounded : Icons.battery_std_rounded,
                  color: _color,
                  size: 26,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      battery.isCharging ? 'CHARGING' : 'BATTERY LEVEL',
                      style: const TextStyle(
                        color: Colors.grey,
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 1.0,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.baseline,
                      textBaseline: TextBaseline.alphabetic,
                      children: [
                        Text(
                          '${battery.percentage.toStringAsFixed(0)}%',
                          style: TextStyle(
                            color: _color,
                            fontSize: 32,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Text(
                          '${battery.voltage.toStringAsFixed(1)}V',
                          style: const TextStyle(
                            color: Colors.white70,
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: (battery.percentage / 100).clamp(0.0, 1.0),
              minHeight: 10,
              backgroundColor: Colors.white10,
              valueColor: AlwaysStoppedAnimation<Color>(_color),
            ),
          ),
        ],
      ),
    );
  }
}
