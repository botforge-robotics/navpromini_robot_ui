import 'package:flutter/material.dart';
import '../config/app_theme.dart';
import '../models/mission.dart';
import '../services/robot_api_service.dart';

class MissionsControlScreen extends StatelessWidget {
  const MissionsControlScreen({
    super.key,
    required this.api,
    required this.missions,
    required this.status,
    required this.onRefresh,
  });

  final RobotApiService api;
  final List<RobotMission> missions;
  final MissionStatus status;
  final VoidCallback onRefresh;

  Future<void> _handleStart(BuildContext context, RobotMission m) async {
    try {
      await api.startMission(m.id);
      onRefresh();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Starting mission "${m.name}"...'), backgroundColor: RobotTheme.primary),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to start mission: $e'), backgroundColor: RobotTheme.danger),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'ROBOT MISSIONS',
                    style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  SizedBox(height: 2),
                  Text(
                    'Execute and control autonomous patrol & inspection sequences',
                    style: TextStyle(color: Colors.grey, fontSize: 13),
                  ),
                ],
              ),
              IconButton(
                icon: const Icon(Icons.refresh_rounded, color: Colors.white70),
                onPressed: onRefresh,
              ),
            ],
          ),
          const SizedBox(height: 20),

          if (missions.isEmpty)
            const Expanded(
              child: Center(
                child: Text('No missions found on robot.', style: TextStyle(color: Colors.grey, fontSize: 16)),
              ),
            )
          else
            Expanded(
              child: ListView.separated(
                itemCount: missions.length,
                separatorBuilder: (_, _) => const SizedBox(height: 12),
                itemBuilder: (context, i) {
                  final m = missions[i];
                  final isCurrentActive = status.isRunning && status.missionId == m.id;

                  return Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: isCurrentActive
                          ? RobotTheme.primary.withValues(alpha: 0.08)
                          : RobotTheme.card,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: isCurrentActive ? RobotTheme.primary : RobotTheme.border,
                        width: isCurrentActive ? 2 : 1.2,
                      ),
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: (m.isGraph ? RobotTheme.primary : RobotTheme.secondary).withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Icon(
                            m.isGraph ? Icons.account_tree_rounded : Icons.route_rounded,
                            color: m.isGraph ? RobotTheme.primary : RobotTheme.secondary,
                            size: 24,
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Text(
                                    m.name,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 17,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  if (m.isGraph)
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: RobotTheme.primary.withValues(alpha: 0.2),
                                        borderRadius: BorderRadius.circular(6),
                                      ),
                                      child: Text(
                                        'GRAPH (${m.nodeCount} nodes)',
                                        style: const TextStyle(
                                          color: RobotTheme.primary,
                                          fontSize: 10,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'ID: ${m.id} · Map: ${m.map ?? "Active Map"}',
                                style: const TextStyle(color: Colors.grey, fontSize: 13),
                              ),
                            ],
                          ),
                        ),

                        if (isCurrentActive) ...[
                          OutlinedButton(
                            onPressed: () async {
                              await api.cancelMission(m.id);
                              onRefresh();
                            },
                            style: OutlinedButton.styleFrom(foregroundColor: RobotTheme.danger),
                            child: const Text('Abort'),
                          ),
                        ] else ...[
                          ElevatedButton.icon(
                            icon: const Icon(Icons.play_arrow_rounded, size: 20),
                            label: const Text('Execute'),
                            onPressed: status.isRunning ? null : () => _handleStart(context, m),
                          ),
                        ],
                      ],
                    ),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}
