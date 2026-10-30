; Java locals for the code pane's variable colors (tree-sitter's locals convention), written against tree-sitter-java.
; `@local.definition.hoisted` is seen everywhere in its scope (a class's fields, a record's components); `@ignore`
; marks identifiers that are not references to a variable.

[
  (class_declaration)
  (interface_declaration)
  (enum_declaration)
  (record_declaration)
  (method_declaration)
  (constructor_declaration)
  (lambda_expression)
  (block)
  (for_statement)
  (enhanced_for_statement)
  (catch_clause)
  (try_with_resources_statement)
] @local.scope

(formal_parameter name: (identifier) @local.definition)
(spread_parameter (variable_declarator name: (identifier) @local.definition))
(local_variable_declaration declarator: (variable_declarator name: (identifier) @local.definition))
(enhanced_for_statement name: (identifier) @local.definition)
(lambda_expression parameters: (identifier) @local.definition)
(inferred_parameters (identifier) @local.definition)
(catch_formal_parameter name: (identifier) @local.definition)
(resource name: (identifier) @local.definition)
(instanceof_expression name: (identifier) @local.definition)
(field_declaration declarator: (variable_declarator name: (identifier) @local.definition.hoisted))
(record_declaration parameters: (formal_parameters (formal_parameter name: (identifier) @local.definition.hoisted)))

(identifier) @local.reference

; A field after `.`, a method's name, a declaration's own name.
(field_access field: (identifier) @ignore)
(method_invocation name: (identifier) @ignore)
(method_declaration name: (identifier) @ignore)
(constructor_declaration name: (identifier) @ignore)
(class_declaration name: (identifier) @ignore)
(interface_declaration name: (identifier) @ignore)
(enum_declaration name: (identifier) @ignore)
(record_declaration name: (identifier) @ignore)
