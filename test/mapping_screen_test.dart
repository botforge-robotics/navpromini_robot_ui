import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:navpromini_robot_ui/models/battery_info.dart';
import 'package:navpromini_robot_ui/screens/mapping_screen.dart';
import 'package:navpromini_robot_ui/services/robot_api_service.dart';

void main() {
  testWidgets('MappingScreen displays status, metrics, and action buttons', (tester) async {
    tester.view.physicalSize = const Size(1024, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    final api = RobotApiService();
    final battery = BatteryInfo(percentage: 85.0, voltage: 24.5, isCharging: false);
    var finishedOrCancelled = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MappingScreen(
            api: api,
            battery: battery,
            onFinishOrCancel: () {
              finishedOrCancelled = true;
            },
          ),
        ),
      ),
    );

    // Initial frame
    await tester.pump();

    // Verify key titles and metrics are present
    expect(find.text('MAPPING IN PROGRESS'), findsOneWidget);
    expect(find.text('SLAM ACTIVE'), findsOneWidget);
    expect(find.text('SESSION TIME'), findsOneWidget);
    expect(find.text('CURRENT POSITION'), findsOneWidget);
    expect(find.text('Done & Save Map'), findsOneWidget);
    expect(find.text('Cancel Mapping'), findsOneWidget);

    // Tapping Cancel Mapping brings up confirmation dialog
    await tester.tap(find.text('Cancel Mapping'));
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Cancel Mapping?'), findsOneWidget);
    expect(find.text('Discard & Exit'), findsOneWidget);

    // Cancel the dialog by clicking "Discard & Exit"
    await tester.tap(find.text('Discard & Exit'));
    await tester.pump(const Duration(milliseconds: 300));

    expect(finishedOrCancelled, isTrue);
  });
}
