import 'package:flutter/material.dart';
import '../config/app_theme.dart';
import '../models/battery_info.dart';
import '../models/mission.dart';
import '../services/robot_api_service.dart';
import '../widgets/battery_indicator.dart';
import '../widgets/save_location_dialog.dart';

class HomeDashboardScreen extends StatelessWidget {
  const HomeDashboardScreen({
    super.key,
    required this.api,
    required this.battery,
    required this.missionStatus,
    required this.currentMap,
    required this.onRefresh,
    required this.onNavigateToTab,
  });

  final RobotApiService api;
  final BatteryInfo battery;
  final MissionStatus missionStatus;
  final String? currentMap;
  final VoidCallback onRefresh;
  final ValueChanged<int> onNavigateToTab;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Row 1: Battery Card + Active Status Card
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                flex: 5,
                child: BatteryIndicator(battery: battery),
              ),
              const SizedBox(width: 20),
              Expanded(
                flex: 6,
                child: _buildRobotStatusCard(context),
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Active Mission Card (if running or waiting)
          if (missionStatus.isRunning) ...[
            _buildActiveMissionBanner(context),
            const SizedBox(height: 24),
          ],

          // Quick Actuators & Actions
          const Text(
            'QUICK ON-SCREEN CONTROLS',
            style: TextStyle(
              color: Colors.grey,
              fontSize: 12,
              fontWeight: FontWeight.bold,
              letterSpacing: 1.1,
            ),
          ),
          const SizedBox(height: 14),

          LayoutBuilder(
            builder: (context, constraints) {
              final cols = constraints.maxWidth > 850 ? 4 : 2;
              return GridView.count(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisCount: cols,
                crossAxisSpacing: 16,
                mainAxisSpacing: 16,
                childAspectRatio: cols == 4 ? 1.45 : 1.85,
                children: [
                  _buildActionCard(
                    context,
                    title: 'Save Location',
                    subtitle: 'Record current pose',
                    icon: Icons.add_location_alt_rounded,
                    color: RobotTheme.primary,
                    onTap: () => SaveLocationDialog.show(context, api, onSaved: onRefresh),
                  ),
                  _buildActionCard(
                    context,
                    title: 'Saved Locations',
                    subtitle: 'Navigate to waypoint',
                    icon: Icons.place_rounded,
                    color: const Color(0xFF40C4FF),
                    onTap: () => onNavigateToTab(1), // Saved Locations Tab
                  ),
                  _buildActionCard(
                    context,
                    title: 'Auto-Dock',
                    subtitle: 'Align to charger',
                    icon: Icons.battery_charging_full_rounded,
                    color: RobotTheme.success,
                    onTap: () async {
                      await api.dockRobot();
                      onRefresh();
                    },
                  ),
                  _buildActionCard(
                    context,
                    title: 'Emergency Stop',
                    subtitle: 'Halt all motors',
                    icon: Icons.front_hand_rounded,
                    color: RobotTheme.danger,
                    onTap: () async {
                      await api.stopMotion();
                      onRefresh();
                    },
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildRobotStatusCard(BuildContext context) {
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
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Flexible(
                child: Text(
                  'ROBOT ONBOARD STATUS',
                  style: TextStyle(color: Colors.grey, fontSize: 11, fontWeight: FontWeight.bold, letterSpacing: 1.0),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: (missionStatus.isRunning ? RobotTheme.primary : RobotTheme.success).withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  missionStatus.isRunning ? missionStatus.state.toUpperCase() : 'READY / IDLE',
                  style: TextStyle(
                    color: missionStatus.isRunning ? RobotTheme.primary : RobotTheme.success,
                    fontWeight: FontWeight.bold,
                    fontSize: 11,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              const Icon(Icons.map_rounded, color: RobotTheme.primary, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Active Map: ${currentMap ?? "Default Map"}',
                  style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Row(
            children: [
              Icon(Icons.speed_rounded, color: Color(0xFF69F0AE), size: 20),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Motion Safety: Interlocks OK',
                  style: TextStyle(color: Colors.white70, fontSize: 13),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildActiveMissionBanner(BuildContext context) {
    final isWaiting = missionStatus.isWaitingForUser;

    // Human-readable action label: prefer active_node_label from SDK,
    // fall back to message, then a generic fallback.
    final actionLabel = missionStatus.activeNodeLabel?.isNotEmpty == true
        ? missionStatus.activeNodeLabel!
        : (missionStatus.message?.isNotEmpty == true
            ? missionStatus.message!
            : (isWaiting ? 'Waiting for your response…' : 'Running mission…'));

    final missionTitle = missionStatus.missionName?.isNotEmpty == true
        ? missionStatus.missionName!
        : (missionStatus.missionId ?? 'Active Task');

    final progressPct = missionStatus.progressPct.clamp(0, 100);
    final elapsedSec = missionStatus.elapsedSec.round();
    final elapsedLabel = elapsedSec >= 60
        ? '${(elapsedSec ~/ 60)}m ${elapsedSec % 60}s'
        : '${elapsedSec}s';

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: isWaiting
            ? RobotTheme.warning.withValues(alpha: 0.15)
            : RobotTheme.primary.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: isWaiting ? RobotTheme.warning : RobotTheme.primary,
          width: 1.5,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: isWaiting ? RobotTheme.warning : RobotTheme.primary,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  isWaiting ? Icons.touch_app_rounded : Icons.play_arrow_rounded,
                  color: Colors.black,
                  size: 28,
                ),
              ),
              const SizedBox(width: 18),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      isWaiting ? 'OPERATOR SIGN-OFF REQUIRED' : 'MISSION EXECUTING',
                      style: TextStyle(
                        color: isWaiting ? RobotTheme.warning : RobotTheme.primary,
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                        letterSpacing: 1.1,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      missionTitle,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 17,
                        fontWeight: FontWeight.bold,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: RobotTheme.danger,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                ),
                onPressed: () async {
                  if (missionStatus.missionId != null) {
                    await api.cancelMission(missionStatus.missionId!);
                    onRefresh();
                  }
                },
                child: const Text('Abort Mission'),
              ),
            ],
          ),
          const SizedBox(height: 14),
          // Current action label
          Row(
            children: [
              Icon(
                _nodeTypeIcon(missionStatus.activeNodeType),
                color: isWaiting ? RobotTheme.warning : RobotTheme.primary,
                size: 18,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  actionLabel,
                  style: TextStyle(
                    color: isWaiting
                        ? RobotTheme.warning
                        : Colors.white.withValues(alpha: 0.92),
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Text(
                elapsedLabel,
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.5),
                  fontSize: 13,
                ),
              ),
            ],
          ),
          if (progressPct > 0) ...[
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: progressPct / 100.0,
                backgroundColor: Colors.white.withValues(alpha: 0.12),
                valueColor: AlwaysStoppedAnimation<Color>(
                  isWaiting ? RobotTheme.warning : RobotTheme.primary,
                ),
                minHeight: 6,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              '$progressPct% complete',
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.45),
                fontSize: 11,
              ),
            ),
          ],
        ],
      ),
    );
  }

  IconData _nodeTypeIcon(String? nodeType) {
    switch (nodeType) {
      case 'navigate_waypoint':
      case 'navigate_coordinates':
        return Icons.navigation_rounded;
      case 'dock':
      case 'undock':
        return Icons.electrical_services_rounded;
      case 'ui_speech':
      case 'speech':
        return Icons.record_voice_over_rounded;
      case 'ui_notification':
        return Icons.notifications_rounded;
      case 'ui_choice':
      case 'ui_form':
      case 'ui_input':
        return Icons.touch_app_rounded;
      case 'condition':
        return Icons.alt_route_rounded;
      case 'delay':
      case 'wait':
        return Icons.timer_rounded;
      case 'api_call':
      case 'http_request':
        return Icons.cloud_rounded;
      default:
        return Icons.radio_button_checked_rounded;
    }
  }



  Widget _buildActionCard(
    BuildContext context, {
    required String title,
    required String subtitle,
    required IconData icon,
    required Color color,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Ink(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: RobotTheme.card,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: RobotTheme.border, width: 1.2),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: color, size: 22),
              ),
              const SizedBox(height: 10),
              Text(
                title,
                style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: const TextStyle(color: Colors.grey, fontSize: 12),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
