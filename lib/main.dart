import 'package:flutter/material.dart';
import 'config/app_theme.dart';
import 'screens/main_kiosk_shell.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const NavProMiniRobotApp());
}

class NavProMiniRobotApp extends StatelessWidget {
  const NavProMiniRobotApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'NavPro Mini Onboard Touchscreen UI',
      debugShowCheckedModeBanner: false,
      theme: RobotTheme.theme,
      home: const MainKioskShell(),
    );
  }
}
