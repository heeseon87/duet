; TypeScript (and TSX) locals for the code pane's variable colors: tree-sitter-javascript's and tree-sitter-typescript's
; queries/locals.scm (MIT) together, with loops, catch parameters, a lone arrow parameter and destructured shorthands.
; Members (`a.b`), object keys and types have their own node types, so they never read as references.

[
  (statement_block)
  (function_expression)
  (arrow_function)
  (function_declaration)
  (method_definition)
  (for_statement)
  (for_in_statement)
  (catch_clause)
] @local.scope

(pattern/identifier) @local.definition
(variable_declarator name: (identifier) @local.definition)
(required_parameter (identifier) @local.definition)
(optional_parameter (identifier) @local.definition)
(arrow_function parameter: (identifier) @local.definition)
(for_in_statement left: (identifier) @local.definition)
(catch_clause parameter: (identifier) @local.definition)
(shorthand_property_identifier_pattern) @local.definition

(identifier) @local.reference
(shorthand_property_identifier) @local.reference

; A declaration's own name.
(function_declaration name: (identifier) @ignore)
