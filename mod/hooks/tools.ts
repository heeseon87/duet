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
      "description": "Read a map: its JSON, the Mermaid it draws, and open comment threads. The result starts with how to draw and tag maps: read it before you change one with duet_map_update (canvas_update in Duet's messages). Duet's messages call this tool canvas_read (mcp__duet__canvas_read).",
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
      "description": "Create a new design map (empty). Then fill it with canvas_update. The result starts with how to draw and tag maps: read it, then fill the map with duet_map_update (canvas_update in Duet's messages). When this terminal has no pinned map, the new map becomes its map. From a folder outside every Duet workspace, it first opens the folder's git repository in Duet as a workspace. Duet's messages call this tool canvas_create (mcp__duet__canvas_create).",
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
          "code": {
            "description": "only for a map made to review code that exists: what it reviews, \"pr\" (the PR of the checked-out branch), \"pr:123\", \"branch:main...feature\" or \"commits:abc..def\". Leave it out for a design map: it is bound to this tree from its current commit, so the code built from it shows in the review",
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
      "description": "Change a map. Elements, messages and decisions upsert by id (null clears a field); relations upsert by from/to/kind (\"remove\": true deletes one). Removing an element removes its relations. Every successful call makes a new revision the person can compare. Duet's messages call this tool canvas_update (mcp__duet__canvas_update).",
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
                  "description": "repo-relative paths",
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
