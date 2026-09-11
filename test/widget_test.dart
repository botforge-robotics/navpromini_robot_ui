import 'package:flutter_test/flutter_test.dart';
import 'package:navpromini_robot_ui/main.dart';

void main() {
  testWidgets('Robot UI mounts smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const NavProMiniRobotApp());
    expect(find.text('NAVPRO MINI'), findsOneWidget);
  });
}
