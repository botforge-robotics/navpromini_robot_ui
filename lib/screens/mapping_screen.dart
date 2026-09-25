import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../config/app_theme.dart';
import '../models/battery_info.dart';
import '../services/robot_api_service.dart';

class MappingScreen extends StatefulWidget {
  const MappingScreen({
    super.key,
    required this.api,
    required this.battery,
    required this.onFinishOrCancel,
  });

  final RobotApiService api;
  final BatteryInfo battery;
  final VoidCallback onFinishOrCancel;

  @override
  State<MappingScreen> createState() => _MappingScreenState();
}

class _MappingScreenState extends State<MappingScreen> with SingleTickerProviderStateMixin {
  int _elapsedSeconds = 0;
  Timer? _sessionTimer;
  Timer? _poseTimer;
  Map<String, double> _currentPose = {'x': 0.0, 'y': 0.0, 'theta': 0.0};
  bool _isSaving = false;
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);

    _sessionTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _elapsedSeconds++);
    });

    _fetchPose();
    _poseTimer = Timer.periodic(const Duration(milliseconds: 1500), (_) => _fetchPose());
  }

  @override
  void dispose() {
    _sessionTimer?.cancel();
    _poseTimer?.cancel();
    _pulseController.dispose();
    super.dispose();
  }

  Future<void> _fetchPose() async {
    try {
      final pose = await widget.api.getCurrentPose();
      if (mounted) {
        setState(() => _currentPose = pose);
      }
    } catch (_) {}
  }

  String _formatDuration(int totalSeconds) {
    final minutes = (totalSeconds ~/ 60).toString().padLeft(2, '0');
    final seconds = (totalSeconds % 60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  Future<void> _confirmFinishAndSave() async {
    final defaultName = 'map_${DateFormat('yyyyMMdd_HHmm').format(DateTime.now())}';
    final nameController = TextEditingController(text: defaultName);

    final mapName = await showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: RobotTheme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: const Row(
          children: [
            Icon(Icons.save_rounded, color: RobotTheme.primary),
            SizedBox(width: 10),
            Text('Finish & Save Map'),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Enter a unique name for this newly generated map:',
              style: TextStyle(color: Colors.grey, fontSize: 13),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: nameController,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Map Name',
                prefixIcon: Icon(Icons.map_rounded),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(null),
            child: const Text('Cancel', style: TextStyle(color: Colors.grey)),
          ),
          ElevatedButton(
            onPressed: () {
              final text = nameController.text.trim();
              if (text.isNotEmpty) Navigator.of(ctx).pop(text);
            },
            child: const Text('Save & Finish'),
          ),
        ],
      ),
    );

    if (mapName == null || mapName.isEmpty || !mounted) return;

    setState(() => _isSaving = true);
    try {
      await widget.api.finishMapping(mapName);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Map "$mapName" saved successfully! Returning to Dashboard.')),
      );
      widget.onFinishOrCancel();
    } catch (e) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to save map: $e'),
          backgroundColor: RobotTheme.danger,
        ),
      );
    }
  }

  Future<void> _confirmCancel() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: RobotTheme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: const Text('Cancel Mapping?'),
        content: const Text(
          'Are you sure you want to stop mapping? Any unsaved map data will be discarded.',
          style: TextStyle(color: Colors.grey),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Keep Mapping', style: TextStyle(color: Colors.grey)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: RobotTheme.danger),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Discard & Exit', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      setState(() => _isSaving = true);
      try {
        await widget.api.cancelMapping();
      } catch (_) {}
      if (mounted) widget.onFinishOrCancel();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isSaving) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: RobotTheme.primary),
            SizedBox(height: 20),
            Text(
              'Finalizing Map & Switching to Navigation…',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
          ],
        ),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Row 1: Top Status Banner with Radar Pulse
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
            decoration: BoxDecoration(
              color: const Color(0xFF132238),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: RobotTheme.primary.withValues(alpha: 0.5), width: 1.5),
              boxShadow: [
                BoxShadow(
                  color: RobotTheme.primary.withValues(alpha: 0.12),
                  blurRadius: 18,
                  spreadRadius: 2,
                ),
              ],
            ),
            child: Row(
              children: [
                AnimatedBuilder(
                  animation: _pulseController,
                  builder: (context, child) {
                    final scale = 1.0 + (_pulseController.value * 0.18);
                    final alpha = 0.4 + (_pulseController.value * 0.6);
                    return Transform.scale(
                      scale: scale,
                      child: Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: RobotTheme.primary.withValues(alpha: 0.15),
                          border: Border.all(
                            color: RobotTheme.primary.withValues(alpha: alpha),
                            width: 2,
                          ),
                        ),
                        child: const Icon(
                          Icons.radar_rounded,
                          color: RobotTheme.primary,
                          size: 28,
                        ),
                      ),
                    );
                  },
                ),
                const SizedBox(width: 18),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Text(
                            'MAPPING IN PROGRESS',
                            style: TextStyle(
                              color: RobotTheme.primary,
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 1.2,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: RobotTheme.warning.withValues(alpha: 0.2),
                              borderRadius: BorderRadius.circular(6),
                              border: Border.all(color: RobotTheme.warning),
                            ),
                            child: const Text(
                              'SLAM ACTIVE',
                              style: TextStyle(
                                color: RobotTheme.warning,
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Robot is recording LiDAR scans and wheel odometry into an occupancy grid.',
                        style: TextStyle(color: Colors.grey, fontSize: 13),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // Row 2: Live Metrics Cards (Elapsed Time, Position, Battery)
          Row(
            children: [
              Expanded(
                child: _buildMetricCard(
                  icon: Icons.timer_outlined,
                  color: const Color(0xFF40C4FF),
                  title: 'SESSION TIME',
                  value: _formatDuration(_elapsedSeconds),
                  subtitle: 'Elapsed duration',
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: _buildMetricCard(
                  icon: Icons.location_searching_rounded,
                  color: RobotTheme.primary,
                  title: 'CURRENT POSITION',
                  value: 'X: ${_currentPose['x']?.toStringAsFixed(2)} m',
                  subtitle: 'Y: ${_currentPose['y']?.toStringAsFixed(2)} m  |  θ: ${_currentPose['theta']?.toStringAsFixed(1)} rad',
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: _buildMetricCard(
                  icon: widget.battery.isCharging
                      ? Icons.bolt_rounded
                      : Icons.battery_std_rounded,
                  color: widget.battery.percentage < 20
                      ? RobotTheme.danger
                      : RobotTheme.success,
                  title: widget.battery.isCharging
                      ? 'BATTERY (CHARGING)'
                      : 'BATTERY LEVEL',
                  value: '${widget.battery.percentage.toStringAsFixed(0)}%',
                  subtitle:
                      '${widget.battery.voltage.toStringAsFixed(1)} V  |  ${widget.battery.isCharging ? "Charging" : "On Battery"}',
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Row 3: Operational Guidance Card
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: RobotTheme.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: RobotTheme.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.info_outline_rounded, color: RobotTheme.primary, size: 20),
                    SizedBox(width: 8),
                    Text(
                      'HOW TO MAP EFFECTIVELY',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 1.0,
                        color: Colors.grey,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _buildBulletPoint('Control the robot: Drive it using Mission Planner, mobile app, or joystick.'),
                _buildBulletPoint('Drive slowly near obstacles, walls, and corners to build a clean map.'),
                _buildBulletPoint('Loop closures: Return to previously visited areas to allow SLAM to optimize.'),
                _buildBulletPoint('When finished, tap "Done & Save Map" below or save directly from Mission Planner.'),
              ],
            ),
          ),
          const SizedBox(height: 28),

          // Row 4: Action Buttons (Done & Save vs Cancel)
          Row(
            children: [
              Expanded(
                flex: 4,
                child: OutlinedButton.icon(
                  onPressed: _confirmCancel,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: RobotTheme.danger,
                    side: const BorderSide(color: RobotTheme.danger, width: 1.5),
                    padding: const EdgeInsets.symmetric(vertical: 18),
                  ),
                  icon: const Icon(Icons.close_rounded, size: 22),
                  label: const Text('Cancel Mapping', style: TextStyle(fontSize: 16)),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                flex: 6,
                child: ElevatedButton.icon(
                  onPressed: _confirmFinishAndSave,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: RobotTheme.primary,
                    foregroundColor: Colors.black,
                    padding: const EdgeInsets.symmetric(vertical: 18),
                  ),
                  icon: const Icon(Icons.check_circle_rounded, size: 24),
                  label: const Text(
                    'Done & Save Map',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMetricCard({
    required IconData icon,
    required Color color,
    required String title,
    required String value,
    required String subtitle,
  }) {
    return Container(
      height: 116,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: RobotTheme.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: RobotTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 16),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    color: Colors.grey,
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.8,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          Text(
            value,
            style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: Colors.white,
            ),
          ),
          Text(
            subtitle,
            style: const TextStyle(color: Colors.grey, fontSize: 12),
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }

  Widget _buildBulletPoint(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('• ', style: TextStyle(color: RobotTheme.primary, fontSize: 16, height: 1.2)),
          Expanded(
            child: Text(text, style: const TextStyle(color: Colors.white70, fontSize: 13, height: 1.3)),
          ),
        ],
      ),
    );
  }
}
