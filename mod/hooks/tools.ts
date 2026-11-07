// Written by scripts/mod-tools.ts from server/agent/canvasTools.ts: run `npm run mod:tools` after changing those tools.
import type { ToolSpec } from 'claude-code'

/** Each tool, and the Duet canvas tool it relays to. */
export const TOOLS: { relays: string; spec: ToolSpec }[] = [
  {
    "relays": "canvas_list",
    "spec": {
      "name": "duet_map_list",
      "description": "List the design maps of this workspace. Duet's messages call this tool canvas_list (mcp__duet__canvas_list).",
      "inputSchema": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "isDeferred": false
    }
  },
  {
    "relays": "canvas_read",
    "spec": {
      "name": "duet_map_read",
      "description": "Read a map: its JSON, the Mermaid it draws, and open comment threads. How to draw and tag maps is at the end of duet_map_create's description: follow it when you change a map with duet_map_update (canvas_update in Duet's messages). Duet's messages call this tool canvas_read (mcp__duet__canvas_read).",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          }
        },
        "required": [
          "name"
        ],
        "additionalProperties": false
      },
      "isDeferred": false
    }
  },
  {
    "relays": "canvas_create",
    "spec": {
      "name": "duet_map_create",
      "description": "Create a new design map and draw its first version in the same call: elements, relations (messages for a sequence map) and decisions take the same shape as in canvas_update. Leave them out to start empty. Change the map later with canvas_update. When this terminal has no pinned map, the new map becomes its map. From a folder outside every Duet workspace, it first opens the folder's git repository in Duet as a workspace. Duet's messages call this tool canvas_create (mcp__duet__canvas_create).\n\nHow to draw and tag maps, here and with duet_map_update (canvas_update in Duet's messages):\nDuet canvas: design maps the person reviews with you in the browser, beside this chat.\n- A class map shows groups (packages), classes and labelled relations. Use it to discuss structure: who depends on whom, and what passes along each line.\n- Label every relation with what it carries (\"upload(location, files)\"), and number the steps of a flow with \"step\".\n- Pick each relation's kind from the code that ties the two and give that code in via (\"field userRepository\"): a field, an injected one included, is an association, not a dependency.\n- Mark how each element touches the code with \"change\": add (new), modify, delete, result (data that comes out); leave it out for a part the work keeps as it is.\n- Leave out what goes without saying: an element's kind class, a relation's kind association, a label the same as the id.\n- When a design fork needs the person's choice, add a decision (D1 with options D1-a, D1-b) and tag the elements and relations of each option with decision/option. Never choose for them; they choose in the browser.\n- Give every decision a why: what keeps you from settling it from the code and the request, with its tags (convention, scope, irreversible, context, tie). If no tag fits, it is not the person's decision: pick yourself and say in chat what you picked and why.\n- When one option fits better on what you found, name it in recommended (and say why in its impact); leave it out on a tie. The person sees it as your pick and still decides.\n- Tag everything a decision shapes: the parts each option adds or changes get decision + option, and a part the decision touches whichever way it goes gets decision alone. The person sees these tags as pins on the map.\n- When the person chooses, the other options' parts are removed and the chosen ones keep their tags. Keep those tags in every later update; never clear them because the decision is made.\n- When asked to tag existing decisions, read the map, find the parts each decision shaped, and add decision (and, for a made decision, its chosen option) to them.\n- The person's canvas comments arrive as prompts that name the map and the target. Answer in chat, and update the map so the drawing matches what you said.\n- Keep the map and the code in step: when you change the code's structure, update the map in the same turn.\n- Each map is bound to the code it is about, and the person reviews that code beside it. When you build or change the code of a part, set the part's files (relative to the folder canvas_read names for them) in the same turn: the review lists each changed file under the part that names it, and the map marks which parts are built.\n- The person can also edit the map directly (labels, status, notes, removals). Read the map before you change it, and keep their edits.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "lowercase file name, e.g. thumbnail-worker"
          },
          "diagram": {
            "type": "string",
            "enum": [
              "class",
              "sequence"
            ]
          },
          "title": {
            "type": "string"
          },
          "context": {
            "description": "one or two sentences: what this map is for",
            "type": "string"
          },
          "note": {
            "description": "one short line for the revision timeline when you draw here",
            "type": "string"
          },
          "direction": {
            "type": "string",
            "enum": [
              "TB",
              "LR",
              "BT",
              "RL"
            ]
          },
          "elements": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "description": "ASCII id, unique on the map"
                },
                "label": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "kind": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "group",
                        "class",
                        "interface",
                        "enum",
                        "table",
                        "resource",
                        "external",
                        "actor"
                      ]
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "parent": {
                  "description": "id of a group element",
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "change": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "keep",
                        "result",
                        "modify",
                        "delete",
                        "add"
                      ]
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "members": {
                  "anyOf": [
                    {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "text": {
                            "type": "string"
                          },
                          "change": {
                            "type": "string",
                            "enum": [
                              "add",
                              "modify",
                              "delete"
                            ]
                          }
                        },
                        "required": [
                          "text"
                        ],
                        "additionalProperties": false
                      }
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "note": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "files": {
                  "description": "paths relative to the folder canvas_create and canvas_read name for the map's files, or absolute",
                  "anyOf": [
                    {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "decision": {
                  "description": "the decision that shapes this part (D1). Tag every part a decision shapes, and keep the tag after the person chooses: the map shows what each decision shaped",
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "option": {
                  "description": "the option this part belongs to (D1-a); for a made decision, its chosen option. Leave it out when the part stands whichever way the decision goes",
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "before": {
                  "description": "move this element right before this sibling (same parent). Top-level groups are drawn in map order: left to right within a row (top to bottom when direction is LR); boxes tied by lines go where the lines put them. Keep an order the person set unless asked",
                  "type": "string"
                },
                "after": {
                  "description": "move this element right after this sibling (same parent)",
                  "type": "string"
                }
              },
              "required": [
                "id"
              ],
              "additionalProperties": false
            }
          },
          "relations": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "from": {
                  "type": "string"
                },
                "to": {
                  "type": "string"
                },
                "kind": {
                  "description": "how from is tied to to in the code; give that code in via. association (the default): from keeps to in a field: a collaborator it holds (injected through the constructor or not), a repository, an enum or value it stores (a field wins over the calls made on it); dependency: from touches to only while a call runs: a parameter, a local variable, a return type, a static call, an object it makes and drops, an exception it throws; also a line to or from a box that is no class (an actor, a table, an endpoint); inheritance: from extends class to; realization: from implements interface to; aggregation: from holds to (often a collection of them), and to lives on without from; composition: from owns to, which is made with from and ends with it. Composition and aggregation draw the diamond at from, the whole",
                  "type": "string",
                  "enum": [
                    "association",
                    "dependency",
                    "inheritance",
                    "realization",
                    "composition",
                    "aggregation"
                  ]
                },
                "via": {
                  "description": "the code that ties from to to: one of field, constructor, param, local, return, call, new, throws, extends, implements then its name, e.g. \"field userRepository\", \"param request\", \"extends AuditEntity\". A via that is evidence for another kind gets a note",
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "label": {
                  "description": "what passes along this line, e.g. \"upload(location, files)\"",
                  "type": "string"
                },
                "step": {
                  "description": "order in a flow; drawn as ①②③",
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "change": {
                  "type": "string",
                  "enum": [
                    "add",
                    "delete"
                  ]
                },
                "decision": {
                  "description": "the decision that shapes this line (D1); keep it after the choice",
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "option": {
                  "description": "the option this line belongs to (D1-a)",
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "remove": {
                  "description": "true removes the relation with this from/to/kind",
                  "type": "boolean"
                }
              },
              "required": [
                "from",
                "to"
              ],
              "additionalProperties": false
            }
          },
          "messages": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string"
                },
                "from": {
                  "type": "string"
                },
                "to": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "kind": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "call",
                        "reply",
                        "async",
                        "note"
                      ]
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "label": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "change": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "keep",
                        "result",
                        "modify",
                        "delete",
                        "add"
                      ]
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "after": {
                  "description": "insert after this message id (new messages only)",
                  "type": "string"
                }
              },
              "required": [
                "id"
              ],
              "additionalProperties": false
            }
          },
          "decisions": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "description": "D1, D2, ..."
                },
                "question": {
                  "type": "string"
                },
                "options": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string",
                        "description": "D1-a"
                      },
                      "text": {
                        "type": "string"
                      },
                      "impact": {
                        "type": "string"
                      },
                      "rejected": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id",
                      "text"
                    ],
                    "additionalProperties": false
                  }
                },
                "why": {
                  "description": "why you ask instead of going on; give it with every decision",
                  "type": "object",
                  "properties": {
                    "text": {
                      "type": "string",
                      "description": "one or two sentences on what keeps you from settling it yourself, with the facts you found (the two conventions, the other maps it reaches)"
                    },
                    "tags": {
                      "minItems": 1,
                      "type": "array",
                      "items": {
                        "type": "string",
                        "enum": [
                          "convention",
                          "scope",
                          "irreversible",
                          "context",
                          "tie"
                        ]
                      },
                      "description": "convention: the code or the maps follow more than one convention and nothing says which. scope: it reaches past this task (an API others call, another map, shared code). irreversible: costly to undo once it ships. context: it turns on what only the person knows (plans, priorities). tie: the options weigh the same on everything you can check"
                    }
                  },
                  "required": [
                    "text",
                    "tags"
                  ],
                  "additionalProperties": false
                },
                "recommended": {
                  "description": "the option you lean to (D1-a), when one fits better on what you found; leave it out on a tie. The person still chooses",
                  "type": [
                    "string",
                    "null"
                  ]
                }
              },
              "required": [
                "id"
              ],
              "additionalProperties": false
            }
          },
          "code": {
            "description": "only for a map made to review code that exists: what it reviews, \"pr\" (the PR of the checked-out branch), \"pr:123\", \"branch:main...feature\" or \"commits:abc..def\". Leave it out for a design map: it is bound to this tree from its current commit, so the code built from it shows in the review",
            "type": "string"
          },
          "repo": {
            "description": "a folder of the git repository the code is in, absolute or relative to this folder; for code built in a worktree, that worktree (a design map follows its uncommitted changes). Leave it out when that is this folder's tree. In another repository outside the workspace, the map's files are relative to its root",
            "type": "string"
          }
        },
        "required": [
          "name",
          "diagram",
          "title"
        ],
        "additionalProperties": false
      },
      "isDeferred": false
    }
  },
  {
    "relays": "canvas_update",
    "spec": {
      "name": "duet_map_update",
      "description": "Change a map. Elements, messages and decisions upsert by id (null clears a field); relations upsert by from/to/kind (\"remove\": true deletes one). Removing an element removes its relations. Every successful call makes a new revision the person can compare. Draw and tag as the guide at the end of duet_map_create's description says. Duet's messages call this tool canvas_update (mcp__duet__canvas_update).",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "note": {
            "type": "string",
            "description": "one short line: why this change (shown in the revision timeline)"
          },
          "baseRevision": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "title": {
            "type": "string"
          },
          "context": {
            "type": [
              "string",
              "null"
            ]
          },
          "direction": {
            "anyOf": [
              {
                "type": "string",
                "enum": [
                  "TB",
                  "LR",
                  "BT",
                  "RL"
                ]
              },
              {
                "type": "null"
              }
            ]
          },
          "elements": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "description": "ASCII id, unique on the map"
                },
                "label": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "kind": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "group",
                        "class",
                        "interface",
                        "enum",
                        "table",
                        "resource",
                        "external",
                        "actor"
                      ]
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "parent": {
                  "description": "id of a group element",
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "change": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "keep",
                        "result",
                        "modify",
                        "delete",
                        "add"
                      ]
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "members": {
                  "anyOf": [
                    {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "text": {
                            "type": "string"
                          },
                          "change": {
                            "type": "string",
                            "enum": [
                              "add",
                              "modify",
                              "delete"
                            ]
                          }
                        },
                        "required": [
                          "text"
                        ],
                        "additionalProperties": false
                      }
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "note": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "files": {
                  "description": "paths relative to the folder canvas_create and canvas_read name for the map's files, or absolute",
                  "anyOf": [
                    {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "decision": {
                  "description": "the decision that shapes this part (D1). Tag every part a decision shapes, and keep the tag after the person chooses: the map shows what each decision shaped",
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "option": {
                  "description": "the option this part belongs to (D1-a); for a made decision, its chosen option. Leave it out when the part stands whichever way the decision goes",
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "before": {
                  "description": "move this element right before this sibling (same parent). Top-level groups are drawn in map order: left to right within a row (top to bottom when direction is LR); boxes tied by lines go where the lines put them. Keep an order the person set unless asked",
                  "type": "string"
                },
                "after": {
                  "description": "move this element right after this sibling (same parent)",
                  "type": "string"
                }
              },
              "required": [
                "id"
              ],
              "additionalProperties": false
            }
          },
          "relations": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "from": {
                  "type": "string"
                },
                "to": {
                  "type": "string"
                },
                "kind": {
                  "description": "how from is tied to to in the code; give that code in via. association (the default): from keeps to in a field: a collaborator it holds (injected through the constructor or not), a repository, an enum or value it stores (a field wins over the calls made on it); dependency: from touches to only while a call runs: a parameter, a local variable, a return type, a static call, an object it makes and drops, an exception it throws; also a line to or from a box that is no class (an actor, a table, an endpoint); inheritance: from extends class to; realization: from implements interface to; aggregation: from holds to (often a collection of them), and to lives on without from; composition: from owns to, which is made with from and ends with it. Composition and aggregation draw the diamond at from, the whole",
                  "type": "string",
                  "enum": [
                    "association",
                    "dependency",
                    "inheritance",
                    "realization",
                    "composition",
                    "aggregation"
                  ]
                },
                "via": {
                  "description": "the code that ties from to to: one of field, constructor, param, local, return, call, new, throws, extends, implements then its name, e.g. \"field userRepository\", \"param request\", \"extends AuditEntity\". A via that is evidence for another kind gets a note",
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "label": {
                  "description": "what passes along this line, e.g. \"upload(location, files)\"",
                  "type": "string"
                },
                "step": {
                  "description": "order in a flow; drawn as ①②③",
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "change": {
                  "type": "string",
                  "enum": [
                    "add",
                    "delete"
                  ]
                },
                "decision": {
                  "description": "the decision that shapes this line (D1); keep it after the choice",
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "option": {
                  "description": "the option this line belongs to (D1-a)",
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "remove": {
                  "description": "true removes the relation with this from/to/kind",
                  "type": "boolean"
                }
              },
              "required": [
                "from",
                "to"
              ],
              "additionalProperties": false
            }
          },
          "messages": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string"
                },
                "from": {
                  "type": "string"
                },
                "to": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "kind": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "call",
                        "reply",
                        "async",
                        "note"
                      ]
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "label": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "change": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "keep",
                        "result",
                        "modify",
                        "delete",
                        "add"
                      ]
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "after": {
                  "description": "insert after this message id (new messages only)",
                  "type": "string"
                }
              },
              "required": [
                "id"
              ],
              "additionalProperties": false
            }
          },
          "decisions": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "description": "D1, D2, ..."
                },
                "question": {
                  "type": "string"
                },
                "options": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string",
                        "description": "D1-a"
                      },
                      "text": {
                        "type": "string"
                      },
                      "impact": {
                        "type": "string"
                      },
                      "rejected": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "id",
                      "text"
                    ],
                    "additionalProperties": false
                  }
                },
                "why": {
                  "description": "why you ask instead of going on; give it with every decision",
                  "type": "object",
                  "properties": {
                    "text": {
                      "type": "string",
                      "description": "one or two sentences on what keeps you from settling it yourself, with the facts you found (the two conventions, the other maps it reaches)"
                    },
                    "tags": {
                      "minItems": 1,
                      "type": "array",
                      "items": {
                        "type": "string",
                        "enum": [
                          "convention",
                          "scope",
                          "irreversible",
                          "context",
                          "tie"
                        ]
                      },
                      "description": "convention: the code or the maps follow more than one convention and nothing says which. scope: it reaches past this task (an API others call, another map, shared code). irreversible: costly to undo once it ships. context: it turns on what only the person knows (plans, priorities). tie: the options weigh the same on everything you can check"
                    }
                  },
                  "required": [
                    "text",
                    "tags"
                  ],
                  "additionalProperties": false
                },
                "recommended": {
                  "description": "the option you lean to (D1-a), when one fits better on what you found; leave it out on a tie. The person still chooses",
                  "type": [
                    "string",
                    "null"
                  ]
                }
              },
              "required": [
                "id"
              ],
              "additionalProperties": false
            }
          },
          "remove": {
            "type": "object",
            "properties": {
              "elements": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "messages": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "fragments": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "decisions": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "additionalProperties": false
          }
        },
        "required": [
          "name",
          "note"
        ],
        "additionalProperties": false
      },
      "isDeferred": true
    }
  },
  {
    "relays": "canvas_reply",
    "spec": {
      "name": "duet_map_reply",
      "description": "Pin a short reply to a comment thread on the canvas (your chat answer is also shown there). Use it to close the loop on a thread you resolved. Duet's messages call this tool canvas_reply (mcp__duet__canvas_reply).",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "threadId": {
            "type": "string"
          },
          "text": {
            "type": "string"
          }
        },
        "required": [
          "name",
          "threadId",
          "text"
        ],
        "additionalProperties": false
      },
      "isDeferred": false
    }
  }
]
