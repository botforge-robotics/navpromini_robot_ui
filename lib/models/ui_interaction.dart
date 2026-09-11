class UiInteractionModel {
  UiInteractionModel({
    required this.interactionId,
    required this.nodeId,
    required this.subtype,
    required this.title,
    this.message = '',
    this.timeoutSec = 60.0,
    this.choices = const [],
    this.fields = const [],
    this.imageUrl,
    this.speechText,
  });

  final String interactionId;
  final String nodeId;
  final String subtype; // 'form', 'choices', 'modal', 'kiosk_destination_picker'
  final String title;
  final String message;
  final double timeoutSec;
  final List<String> choices;
  final List<InteractionFormField> fields;
  final String? imageUrl;
  final String? speechText;

  factory UiInteractionModel.fromJson(Map<String, dynamic> json) {
    final params = (json['params'] as Map<String, dynamic>?) ?? json;

    final rawChoices = params['choices'] ?? params['options'];
    final choicesList = rawChoices is List
        ? rawChoices.map((e) => e.toString()).toList()
        : <String>[];

    final rawFields = params['fields'] as List? ?? [];
    final fieldsList = rawFields
        .whereType<Map<String, dynamic>>()
        .map((f) => InteractionFormField.fromJson(f))
        .toList();

    return UiInteractionModel(
      interactionId: json['interaction_id']?.toString() ?? '',
      nodeId: json['node_id']?.toString() ?? '',
      subtype: params['subtype']?.toString() ?? (fieldsList.isNotEmpty ? 'form' : (choicesList.isNotEmpty ? 'choices' : 'modal')),
      title: params['title']?.toString() ?? 'Action Required',
      message: params['message']?.toString() ?? '',
      timeoutSec: (params['timeout_sec'] as num?)?.toDouble() ?? 60.0,
      choices: choicesList,
      fields: fieldsList,
      imageUrl: (params['image_url'] ?? params['media_url'])?.toString(),
      speechText: params['speech_text']?.toString(),
    );
  }
}

class InteractionFormField {
  InteractionFormField({
    required this.key,
    required this.label,
    this.type = 'text', // 'text', 'number', 'select', 'checkbox', 'switch'
    this.required = false,
    this.options = const [],
    this.defaultValue,
  });

  final String key;
  final String label;
  final String type;
  final bool required;
  final List<String> options;
  final dynamic defaultValue;

  factory InteractionFormField.fromJson(Map<String, dynamic> json) {
    return InteractionFormField(
      key: json['key']?.toString() ?? json['id']?.toString() ?? 'field',
      label: json['label']?.toString() ?? 'Field',
      type: json['type']?.toString() ?? 'text',
      required: json['required'] == true,
      options: (json['options'] as List? ?? []).map((e) => e.toString()).toList(),
      defaultValue: json['default_value'] ?? json['defaultValue'],
    );
  }
}
