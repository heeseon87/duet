; TypeScript (and TSX) locals for the code pane's variable colors: tree-sitter-javascript's and tree-sitter-typescript's
; queries/locals.scm (MIT) together, with loops, catch parameters, a lone arrow parameter and destructured shorthands,
; and a class's fields reached through `this`. Members (`a.b`), object keys and types have their own node types, so they
; never read as references. `@local.definition.var` and `@local.definition.member` go up to their function and class
; (RULES in variables.ts).

[
  (statement_block)
  (function_expression)
  (arrow_function)
  (function_declaration)
  (method_definition)
  (for_statement)
  (for_in_statement)
  (catch_clause)
  (class_body)
] @local.scope

(pattern/identifier) @local.definition
(variable_declarator name: (identifier) @local.definition)
(required_parameter (identifier) @local.definition)
(optional_parameter (identifier) @local.definition)
(arrow_function parameter: (identifier) @local.definition)
(for_in_statement left: (identifier) @local.definition)
(catch_clause parameter: (identifier) @local.definition)
(shorthand_property_identifier_pattern) @local.definition
(variable_declaration (variable_declarator name: (identifier) @local.definition.var))
(public_field_definition name: (property_identifier) @local.definition.hoisted)
(required_parameter (accessibility_modifier) pattern: (identifier) @local.definition.member)

(identifier) @local.reference
(shorthand_property_identifier) @local.reference
(member_expression object: (this) property: (property_identifier) @local.reference.member)

; A declaration's own name.
(function_declaration name: (identifier) @ignore)
