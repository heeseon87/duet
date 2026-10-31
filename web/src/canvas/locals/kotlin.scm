; Kotlin locals for the code pane's variable colors (tree-sitter's locals convention), written against
; @tree-sitter-grammars/tree-sitter-kotlin. `@local.definition.hoisted` is seen everywhere in its scope (a class's
; properties); `@ignore` marks identifiers that are not references to a variable; `@local.template` is a string whose
; literal text holds `$name` references (the grammar leaves `"$order"` as text, unlike `${order}`).

[
  (class_declaration)
  (object_declaration)
  (companion_object)
  (function_declaration)
  (secondary_constructor)
  (anonymous_function)
  (lambda_literal)
  (block)
  (for_statement)
  (catch_block)
  (when_expression)
  (setter)
] @local.scope

(parameter (identifier) @local.definition)
(class_parameter (identifier) @local.definition.hoisted)
(class_body (property_declaration (variable_declaration (identifier) @local.definition.hoisted)))
(property_declaration (variable_declaration (identifier) @local.definition))
(property_declaration (multi_variable_declaration (variable_declaration (identifier) @local.definition)))
(for_statement (variable_declaration (identifier) @local.definition))
(for_statement (multi_variable_declaration (variable_declaration (identifier) @local.definition)))
(lambda_parameters (variable_declaration (identifier) @local.definition))
(lambda_parameters (multi_variable_declaration (variable_declaration (identifier) @local.definition)))
(catch_block (identifier) @local.definition)
(when_subject (variable_declaration (identifier) @local.definition))
(setter (identifier) @local.definition)

(identifier) @local.reference
(string_literal) @local.template
; `this.repo`: the class's property, whatever a local of that name.
(navigation_expression (this_expression) (identifier) @local.reference.member)

; A member after `.`, `?.` or `::`; a named argument's name; a type; a declaration's own name.
(navigation_expression (identifier) @ignore .)
(value_argument (identifier) @ignore "=")
(user_type (identifier) @ignore)
(function_declaration name: (identifier) @ignore)
(class_declaration name: (identifier) @ignore)
(object_declaration name: (identifier) @ignore)
