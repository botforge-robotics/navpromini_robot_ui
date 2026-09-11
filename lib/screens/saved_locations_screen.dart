import 'package:flutter/material.dart';
import '../config/app_theme.dart';
import '../models/waypoint.dart';
import '../services/robot_api_service.dart';
import '../widgets/save_location_dialog.dart';

class SavedLocationsScreen extends StatelessWidget {
  const SavedLocationsScreen({
    super.key,
    required this.api,
    required this.waypoints,
    required this.onRefresh,
  });

  final RobotApiService api;
  final List<Waypoint> waypoints;
  final VoidCallback onRefresh;

  Future<void> _confirmNavigate(BuildContext context, Waypoint wp) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: RobotTheme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: Row(
          children: [
            const Icon(Icons.navigation_rounded, color: RobotTheme.primary),
            const SizedBox(width: 10),
            Text('Navigate to "${wp.name}"?'),
          ],
        ),
        content: Text(
          'Target coordinates: (${wp.x.toStringAsFixed(2)}, ${wp.y.toStringAsFixed(2)}). Ensure drive path is clear.',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel', style: TextStyle(color: Colors.grey)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Start Navigation'),
          ),
        ],
      ),
    );

    if (ok == true) {
      try {
        await api.navigateToWaypoint(wp.name);
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Navigating to "${wp.name}"...'),
              backgroundColor: RobotTheme.primary,
            ),
          );
        }
      } catch (e) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Navigation error: $e'), backgroundColor: RobotTheme.danger),
          );
        }
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
                    'SAVED LOCATIONS',
                    style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  SizedBox(height: 2),
                  Text(
                    'Tap any destination station to navigate automatically',
                    style: TextStyle(color: Colors.grey, fontSize: 13),
                  ),
                ],
              ),
              ElevatedButton.icon(
                icon: const Icon(Icons.add_location_alt_rounded, size: 20),
                label: const Text('Save Current Location'),
                onPressed: () => SaveLocationDialog.show(context, api, onSaved: onRefresh),
              ),
            ],
          ),
          const SizedBox(height: 20),

          if (waypoints.isEmpty)
            Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.place_outlined, size: 54, color: Colors.grey),
                    const SizedBox(height: 12),
                    const Text('No saved waypoints on this map yet.', style: TextStyle(color: Colors.grey, fontSize: 16)),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: () => SaveLocationDialog.show(context, api, onSaved: onRefresh),
                      child: const Text('Save Current Pose as Waypoint'),
                    ),
                  ],
                ),
              ),
            )
          else
            Expanded(
              child: GridView.builder(
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 3,
                  crossAxisSpacing: 16,
                  mainAxisSpacing: 16,
                  childAspectRatio: 1.5,
                ),
                itemCount: waypoints.length,
                itemBuilder: (context, i) {
                  final wp = waypoints[i];
                  return Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: () => _confirmNavigate(context, wp),
                      borderRadius: BorderRadius.circular(18),
                      child: Ink(
                        padding: const EdgeInsets.all(18),
                        decoration: BoxDecoration(
                          color: RobotTheme.card,
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(color: RobotTheme.border, width: 1.2),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    color: RobotTheme.primary.withValues(alpha: 0.15),
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: const Icon(Icons.place_rounded, color: RobotTheme.primary, size: 22),
                                ),
                                const Spacer(),
                                const Icon(Icons.arrow_forward_ios_rounded, color: Colors.grey, size: 14),
                              ],
                            ),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  wp.name,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 18,
                                    fontWeight: FontWeight.bold,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'X: ${wp.x.toStringAsFixed(1)}m  Y: ${wp.y.toStringAsFixed(1)}m',
                                  style: const TextStyle(color: Colors.grey, fontSize: 13, fontFamily: 'monospace'),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
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
