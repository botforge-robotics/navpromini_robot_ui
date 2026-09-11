import 'package:flutter/material.dart';
import '../config/app_theme.dart';
import '../services/robot_api_service.dart';

class SaveLocationDialog extends StatefulWidget {
  const SaveLocationDialog({
    super.key,
    required this.api,
    this.onSaved,
  });

  final RobotApiService api;
  final VoidCallback? onSaved;

  static Future<void> show(BuildContext context, RobotApiService api, {VoidCallback? onSaved}) {
    return showDialog(
      context: context,
      builder: (ctx) => SaveLocationDialog(api: api, onSaved: onSaved),
    );
  }

  @override
  State<SaveLocationDialog> createState() => _SaveLocationDialogState();
}

class _SaveLocationDialogState extends State<SaveLocationDialog> {
  final _controller = TextEditingController();
  bool _saving = false;
  Map<String, double>? _currentPose;

  @override
  void initState() {
    super.initState();
    _loadPose();
  }

  Future<void> _loadPose() async {
    final pose = await widget.api.getCurrentPose();
    if (mounted) setState(() => _currentPose = pose);
  }

  Future<void> _handleSave() async {
    final name = _controller.text.trim();
    if (name.isEmpty) return;

    setState(() => _saving = true);
    try {
      await widget.api.saveCurrentLocationAsWaypoint(name);
      if (mounted) {
        Navigator.of(context).pop();
        widget.onSaved?.call();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Saved location "$name" successfully!'),
            backgroundColor: RobotTheme.success,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error saving location: $e'), backgroundColor: RobotTheme.danger),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: RobotTheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: const BorderSide(color: RobotTheme.border, width: 1.5),
      ),
      child: Container(
        width: 460,
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: RobotTheme.primary.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.add_location_alt_rounded, color: RobotTheme.primary, size: 24),
                ),
                const SizedBox(width: 14),
                const Expanded(
                  child: Text(
                    'Save Current Location',
                    style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),

            if (_currentPose != null)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    Text('X: ${_currentPose!['x']!.toStringAsFixed(2)}m',
                        style: const TextStyle(color: Colors.white70, fontSize: 13, fontFamily: 'monospace')),
                    Text('Y: ${_currentPose!['y']!.toStringAsFixed(2)}m',
                        style: const TextStyle(color: Colors.white70, fontSize: 13, fontFamily: 'monospace')),
                    Text('θ: ${_currentPose!['theta']!.toStringAsFixed(2)} rad',
                        style: const TextStyle(color: Colors.white70, fontSize: 13, fontFamily: 'monospace')),
                  ],
                ),
              ),

            const SizedBox(height: 20),
            TextField(
              controller: _controller,
              autofocus: true,
              style: const TextStyle(color: Colors.white, fontSize: 16),
              decoration: const InputDecoration(
                labelText: 'Location Name',
                hintText: 'e.g. Station A, Charger Dock, Inspection Bay',
              ),
            ),
            const SizedBox(height: 24),

            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: _saving ? null : () => Navigator.of(context).pop(),
                  child: const Text('Cancel', style: TextStyle(color: Colors.grey, fontSize: 15)),
                ),
                const SizedBox(width: 12),
                ElevatedButton(
                  onPressed: _saving ? null : _handleSave,
                  child: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black),
                        )
                      : const Text('Save Waypoint'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
