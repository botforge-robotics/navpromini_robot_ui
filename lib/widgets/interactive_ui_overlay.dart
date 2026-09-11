import 'dart:async';
import 'package:flutter/material.dart';
import '../config/app_theme.dart';
import '../models/ui_interaction.dart';
import '../services/robot_api_service.dart';

/// Full-screen or large dialog overlay on the robot's physical display
/// when a mission pauses for operator sign-off or user kiosk selection.
class InteractiveUiOverlay extends StatefulWidget {
  const InteractiveUiOverlay({
    super.key,
    required this.interaction,
    required this.api,
    required this.onDismissed,
  });

  final UiInteractionModel interaction;
  final RobotApiService api;
  final VoidCallback onDismissed;

  @override
  State<InteractiveUiOverlay> createState() => _InteractiveUiOverlayState();
}

class _InteractiveUiOverlayState extends State<InteractiveUiOverlay> {
  final Map<String, dynamic> _formData = {};
  final _formKey = GlobalKey<FormState>();

  Timer? _timer;
  late double _remainingSec;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _remainingSec = widget.interaction.timeoutSec;

    for (final f in widget.interaction.fields) {
      if (f.type == 'checkbox' || f.type == 'switch') {
        _formData[f.key] = f.defaultValue == true;
      } else {
        _formData[f.key] = f.defaultValue?.toString() ?? '';
      }
    }

    if (_remainingSec > 0) {
      _timer = Timer.periodic(const Duration(milliseconds: 200), (t) {
        if (!mounted) return;
        setState(() {
          _remainingSec = (_remainingSec - 0.2).clamp(0.0, widget.interaction.timeoutSec);
          if (_remainingSec <= 0) {
            _timer?.cancel();
            widget.onDismissed();
          }
        });
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _submit({required String action, String? selected, Map<String, dynamic>? data}) async {
    if (_submitting) return;
    setState(() => _submitting = true);
    _timer?.cancel();

    try {
      await widget.api.submitUiResponse(
        interactionId: widget.interaction.interactionId,
        action: action,
        selected: selected,
        formData: data,
      );
      if (mounted) widget.onDismissed();
    } catch (e) {
      if (mounted) {
        setState(() => _submitting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Submission failed: $e'), backgroundColor: RobotTheme.danger),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final progress = widget.interaction.timeoutSec > 0
        ? (_remainingSec / widget.interaction.timeoutSec).clamp(0.0, 1.0)
        : 1.0;

    return Material(
      color: Colors.black.withValues(alpha: 0.85),
      child: Center(
        child: Container(
          width: 640,
          constraints: const BoxConstraints(maxHeight: 740),
          margin: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: RobotTheme.surface,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: RobotTheme.primary, width: 2),
            boxShadow: [
              BoxShadow(
                color: RobotTheme.primary.withValues(alpha: 0.25),
                blurRadius: 30,
                spreadRadius: 4,
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Header
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 18),
                decoration: const BoxDecoration(
                  color: Color(0xFF0E131E),
                  borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: RobotTheme.primary.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.touch_app_rounded, color: RobotTheme.primary, size: 26),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Text(
                        widget.interaction.title,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    if (widget.interaction.timeoutSec > 0)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: (_remainingSec < 10 ? RobotTheme.danger : RobotTheme.warning)
                              .withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: _remainingSec < 10 ? RobotTheme.danger : RobotTheme.warning,
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.timer_outlined,
                              size: 16,
                              color: _remainingSec < 10 ? RobotTheme.danger : RobotTheme.warning,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              '${_remainingSec.toStringAsFixed(0)}s',
                              style: TextStyle(
                                color: _remainingSec < 10 ? RobotTheme.danger : RobotTheme.warning,
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),

              // Timeout Progress Bar
              if (widget.interaction.timeoutSec > 0)
                LinearProgressIndicator(
                  value: progress,
                  minHeight: 4,
                  backgroundColor: Colors.transparent,
                  color: _remainingSec < 10 ? RobotTheme.danger : RobotTheme.primary,
                ),

              // Scrollable Body
              Flexible(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (widget.interaction.message.isNotEmpty) ...[
                        Text(
                          widget.interaction.message,
                          style: const TextStyle(color: Color(0xFFCFD8DC), fontSize: 16, height: 1.4),
                        ),
                        const SizedBox(height: 20),
                      ],

                      if (widget.interaction.imageUrl != null && widget.interaction.imageUrl!.isNotEmpty) ...[
                        ClipRRect(
                          borderRadius: BorderRadius.circular(12),
                          child: Image.network(
                            widget.interaction.imageUrl!,
                            height: 180,
                            fit: BoxFit.cover,
                            errorBuilder: (_, _, _) => const SizedBox.shrink(),
                          ),
                        ),
                        const SizedBox(height: 20),
                      ],

                      // Subtypes
                      if (widget.interaction.subtype == 'form' || widget.interaction.fields.isNotEmpty)
                        _buildForm()
                      else if (widget.interaction.subtype == 'choices')
                        _buildChoices()
                      else if (widget.interaction.subtype == 'kiosk_destination_picker')
                        _buildKioskPicker()
                      else
                        const SizedBox.shrink(),
                    ],
                  ),
                ),
              ),

              // Footer for forms & modals
              if (widget.interaction.subtype == 'form' || widget.interaction.subtype == 'modal')
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: const BoxDecoration(
                    color: Color(0xFF0E131E),
                    borderRadius: BorderRadius.vertical(bottom: Radius.circular(22)),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      OutlinedButton(
                        onPressed: _submitting ? null : () => _submit(action: 'cancel'),
                        child: const Text('Cancel / Skip', style: TextStyle(color: Colors.grey)),
                      ),
                      const SizedBox(width: 14),
                      ElevatedButton(
                        onPressed: _submitting ? null : _handleFormSubmit,
                        child: _submitting
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black),
                              )
                            : Text(widget.interaction.subtype == 'form' ? 'Submit Sign-Off' : 'Acknowledge'),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  void _handleFormSubmit() {
    final form = _formKey.currentState;
    if (form != null && !form.validate()) return;
    form?.save();
    _submit(action: 'submit', data: _formData);
  }

  Widget _buildForm() {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final f in widget.interaction.fields) ...[
            Text(
              '${f.label}${f.required ? ' *' : ''}',
              style: const TextStyle(color: Colors.white70, fontSize: 14, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            if (f.type == 'text' || f.type == 'number')
              TextFormField(
                initialValue: f.defaultValue?.toString() ?? '',
                keyboardType: f.type == 'number' ? TextInputType.number : TextInputType.text,
                style: const TextStyle(color: Colors.white, fontSize: 16),
                decoration: InputDecoration(
                  hintText: 'Enter ${f.label}',
                  hintStyle: const TextStyle(color: Colors.grey),
                ),
                validator: (v) {
                  if (f.required && (v == null || v.trim().isEmpty)) {
                    return 'This field is required';
                  }
                  return null;
                },
                onSaved: (v) => _formData[f.key] = v?.trim(),
              )
            else if (f.type == 'select')
              DropdownButtonFormField<String>(
                initialValue: f.options.isNotEmpty ? f.options.first : null,
                dropdownColor: RobotTheme.card,
                style: const TextStyle(color: Colors.white, fontSize: 16),
                decoration: const InputDecoration(),
                items: [
                  for (final opt in f.options)
                    DropdownMenuItem(value: opt, child: Text(opt)),
                ],
                onChanged: (v) => _formData[f.key] = v,
                onSaved: (v) => _formData[f.key] = v,
              )
            else if (f.type == 'checkbox' || f.type == 'switch')
              Container(
                decoration: BoxDecoration(
                  color: const Color(0xFF242E42),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: RobotTheme.border),
                ),
                child: CheckboxListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  title: Text(f.label, style: const TextStyle(color: Colors.white, fontSize: 15)),
                  value: _formData[f.key] == true,
                  activeColor: RobotTheme.primary,
                  checkColor: Colors.black,
                  onChanged: (v) => setState(() => _formData[f.key] = v ?? false),
                ),
              ),
            const SizedBox(height: 18),
          ],
        ],
      ),
    );
  }

  Widget _buildChoices() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final choice in widget.interaction.choices) ...[
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF222C3E),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 20),
              side: const BorderSide(color: RobotTheme.primary, width: 1.5),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
            onPressed: _submitting ? null : () => _submit(action: choice, selected: choice),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.arrow_forward_rounded, color: RobotTheme.primary, size: 22),
                const SizedBox(width: 12),
                Text(
                  choice.toUpperCase(),
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1.2,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
        ],
      ],
    );
  }

  Widget _buildKioskPicker() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Please select your target destination:',
          style: TextStyle(color: Colors.white70, fontSize: 15),
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 14,
          runSpacing: 14,
          children: [
            for (final choice in widget.interaction.choices)
              InkWell(
                onTap: _submitting
                    ? null
                    : () => _submit(action: 'destination_selected', selected: choice),
                borderRadius: BorderRadius.circular(14),
                child: Container(
                  width: 180,
                  padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
                  decoration: BoxDecoration(
                    color: const Color(0xFF222C3E),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: RobotTheme.primary.withValues(alpha: 0.5)),
                  ),
                  child: Column(
                    children: [
                      const Icon(Icons.place_rounded, color: RobotTheme.primary, size: 36),
                      const SizedBox(height: 10),
                      Text(
                        choice,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}
