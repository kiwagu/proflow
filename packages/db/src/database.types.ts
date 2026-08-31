export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      content_item_scopes: {
        Row: {
          content_item_id: string
          created_at: string
          linked_by: string
          scope_id: string
        }
        Insert: {
          content_item_id: string
          created_at?: string
          linked_by: string
          scope_id: string
        }
        Update: {
          content_item_id?: string
          created_at?: string
          linked_by?: string
          scope_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_item_scopes_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_item_scopes_scope_id_fkey"
            columns: ["scope_id"]
            isOneToOne: false
            referencedRelation: "scopes"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          created_at: string
          created_by: string
          id: string
          owner_user_id: string | null
          space_id: string
          status: string
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          owner_user_id?: string | null
          space_id: string
          status?: string
          title: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          owner_user_id?: string | null
          space_id?: string
          status?: string
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_items_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crdt_document_versions: {
        Row: {
          created_at: string
          created_by: string
          doc_id: string
          frontiers: Json
          id: string
          kind: string
          label: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          doc_id: string
          frontiers: Json
          id?: string
          kind: string
          label?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          doc_id?: string
          frontiers?: Json
          id?: string
          kind?: string
          label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crdt_document_versions_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "crdt_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      crdt_documents: {
        Row: {
          created_at: string
          created_by: string
          format: string
          id: string
          snapshot: string | null
          snapshot_seq: number
          space_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          format?: string
          id?: string
          snapshot?: string | null
          snapshot_seq?: number
          space_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          format?: string
          id?: string
          snapshot?: string | null
          snapshot_seq?: number
          space_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crdt_documents_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crdt_updates: {
        Row: {
          bytes: string
          created_at: string
          created_by: string
          doc_id: string
          seq: number
          writer: string
        }
        Insert: {
          bytes: string
          created_at?: string
          created_by: string
          doc_id: string
          seq?: never
          writer: string
        }
        Update: {
          bytes?: string
          created_at?: string
          created_by?: string
          doc_id?: string
          seq?: never
          writer?: string
        }
        Relationships: [
          {
            foreignKeyName: "crdt_updates_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "crdt_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_edges: {
        Row: {
          created_at: string
          created_by: string
          from_id: string
          id: string
          metadata: Json
          position: number
          relation_type: string
          space_id: string
          to_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          from_id: string
          id?: string
          metadata?: Json
          position?: number
          relation_type: string
          space_id: string
          to_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          from_id?: string
          id?: string
          metadata?: Json
          position?: number
          relation_type?: string
          space_id?: string
          to_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_edges_from_id_fkey"
            columns: ["from_id"]
            isOneToOne: false
            referencedRelation: "knowledge_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_edges_relation_type_fkey"
            columns: ["relation_type"]
            isOneToOne: false
            referencedRelation: "relation_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "knowledge_edges_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_edges_to_id_fkey"
            columns: ["to_id"]
            isOneToOne: false
            referencedRelation: "knowledge_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_resource_scopes: {
        Row: {
          created_at: string
          linked_by: string
          resource_id: string
          scope_id: string
        }
        Insert: {
          created_at?: string
          linked_by: string
          resource_id: string
          scope_id: string
        }
        Update: {
          created_at?: string
          linked_by?: string
          resource_id?: string
          scope_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_resource_scopes_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "knowledge_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_resource_scopes_scope_id_fkey"
            columns: ["scope_id"]
            isOneToOne: false
            referencedRelation: "scopes"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_resource_user_grants: {
        Row: {
          created_at: string
          granted_by: string
          resource_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by: string
          resource_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string
          resource_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_resource_user_grants_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "knowledge_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_resources: {
        Row: {
          body_ref: Json | null
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          kind: string
          last_activity_at: string
          last_modified_at: string
          owner_user_id: string | null
          space_id: string
          status: string
          title: string
          trashed_by: string | null
          updated_at: string
          visibility: string
          workflow_key: string | null
        }
        Insert: {
          body_ref?: Json | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          id?: string
          kind: string
          last_activity_at?: string
          last_modified_at?: string
          owner_user_id?: string | null
          space_id: string
          status?: string
          title: string
          trashed_by?: string | null
          updated_at?: string
          visibility?: string
          workflow_key?: string | null
        }
        Update: {
          body_ref?: Json | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          kind?: string
          last_activity_at?: string
          last_modified_at?: string
          owner_user_id?: string | null
          space_id?: string
          status?: string
          title?: string
          trashed_by?: string | null
          updated_at?: string
          visibility?: string
          workflow_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_resources_kind_fkey"
            columns: ["kind"]
            isOneToOne: false
            referencedRelation: "resource_kinds"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "knowledge_resources_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_resources_workflow_key_fkey"
            columns: ["workflow_key"]
            isOneToOne: false
            referencedRelation: "resource_workflows"
            referencedColumns: ["key"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          avatar_url: string | null
          created_at: string
          id: string
          name: string
          parent_organization_id: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          name: string
          parent_organization_id?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          name?: string
          parent_organization_id?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_parent_organization_id_fkey"
            columns: ["parent_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      outbox_jobs: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          attempt_count: number
          available_at: string
          channel: string
          claim_token: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          created_at: string
          event_name: string
          event_version: number
          id: string
          idempotency_key: string
          last_error: string | null
          locale: string | null
          operation_key: string | null
          payload: Json
          queue_message_id: number | null
          recipient: string | null
          status: string
          template_key: string | null
          updated_at: string
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          attempt_count?: number
          available_at?: string
          channel: string
          claim_token?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          event_name: string
          event_version?: number
          id?: string
          idempotency_key: string
          last_error?: string | null
          locale?: string | null
          operation_key?: string | null
          payload: Json
          queue_message_id?: number | null
          recipient?: string | null
          status?: string
          template_key?: string | null
          updated_at?: string
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          attempt_count?: number
          available_at?: string
          channel?: string
          claim_token?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          event_name?: string
          event_version?: number
          id?: string
          idempotency_key?: string
          last_error?: string | null
          locale?: string | null
          operation_key?: string | null
          payload?: Json
          queue_message_id?: number | null
          recipient?: string | null
          status?: string
          template_key?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          email: string | null
          entity_id: string
          is_super_admin: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          entity_id?: string
          is_super_admin?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          entity_id?: string
          is_super_admin?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      projections: {
        Row: {
          app_type: string
          created_at: string
          created_by: string
          id: string
          name: string
          owner_user_id: string | null
          space_id: string
          spec: Json
          updated_at: string
          view: string
        }
        Insert: {
          app_type: string
          created_at?: string
          created_by: string
          id?: string
          name: string
          owner_user_id?: string | null
          space_id: string
          spec: Json
          updated_at?: string
          view: string
        }
        Update: {
          app_type?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          owner_user_id?: string | null
          space_id?: string
          spec?: Json
          updated_at?: string
          view?: string
        }
        Relationships: [
          {
            foreignKeyName: "projections_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projections_view_fkey"
            columns: ["view"]
            isOneToOne: false
            referencedRelation: "view_types"
            referencedColumns: ["key"]
          },
        ]
      }
      relation_types: {
        Row: {
          created_at: string
          description: string | null
          is_active: boolean
          is_directed: boolean
          key: string
          label: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          is_active?: boolean
          is_directed?: boolean
          key: string
          label: string
        }
        Update: {
          created_at?: string
          description?: string | null
          is_active?: boolean
          is_directed?: boolean
          key?: string
          label?: string
        }
        Relationships: []
      }
      reporting_lines: {
        Row: {
          created_at: string
          created_by: string
          id: string
          manager_id: string
          space_id: string
          subordinate_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          manager_id: string
          space_id: string
          subordinate_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          manager_id?: string
          space_id?: string
          subordinate_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reporting_lines_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_kinds: {
        Row: {
          created_at: string
          description: string | null
          is_active: boolean
          key: string
          label: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          is_active?: boolean
          key: string
          label: string
        }
        Update: {
          created_at?: string
          description?: string | null
          is_active?: boolean
          key?: string
          label?: string
        }
        Relationships: []
      }
      resource_user_state: {
        Row: {
          coarse_status: string
          created_at: string
          id: string
          last_opened_at: string | null
          metadata: Json
          progress: number | null
          resource_id: string
          space_id: string
          starred: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          coarse_status?: string
          created_at?: string
          id?: string
          last_opened_at?: string | null
          metadata?: Json
          progress?: number | null
          resource_id: string
          space_id: string
          starred?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          coarse_status?: string
          created_at?: string
          id?: string
          last_opened_at?: string | null
          metadata?: Json
          progress?: number | null
          resource_id?: string
          space_id?: string
          starred?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_user_state_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "knowledge_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_user_state_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_workflows: {
        Row: {
          created_at: string
          definition: Json
          description: string | null
          is_active: boolean
          key: string
          label: string
        }
        Insert: {
          created_at?: string
          definition: Json
          description?: string | null
          is_active?: boolean
          key: string
          label: string
        }
        Update: {
          created_at?: string
          definition?: Json
          description?: string | null
          is_active?: boolean
          key?: string
          label?: string
        }
        Relationships: []
      }
      role_permission: {
        Row: {
          created_at: string
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permission_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permission_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          id: string
          is_baseline: boolean
          is_mutable: boolean
          key: string
          label: string
          owner_organization_id: string | null
          role_kind: string
          scope: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_baseline?: boolean
          is_mutable?: boolean
          key: string
          label: string
          owner_organization_id?: string | null
          role_kind: string
          scope: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_baseline?: boolean
          is_mutable?: boolean
          key?: string
          label?: string
          owner_organization_id?: string | null
          role_kind?: string
          scope?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      runtime_settings: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          id: string
          is_public: boolean
          key: string
          scope: string
          scope_id: string | null
          scope_target: string | null
          updated_at: string
          updated_by_user_id: string | null
          value: Json
          value_type: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          is_public?: boolean
          key: string
          scope: string
          scope_id?: string | null
          scope_target?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          value: Json
          value_type: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          is_public?: boolean
          key?: string
          scope?: string
          scope_id?: string | null
          scope_target?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          value?: Json
          value_type?: string
        }
        Relationships: []
      }
      scope_memberships: {
        Row: {
          created_at: string
          created_by: string
          scope_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          scope_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          scope_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scope_memberships_scope_id_fkey"
            columns: ["scope_id"]
            isOneToOne: false
            referencedRelation: "scopes"
            referencedColumns: ["id"]
          },
        ]
      }
      scopes: {
        Row: {
          created_at: string
          created_by: string
          id: string
          key: string
          name: string
          space_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          key: string
          name: string
          space_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          key?: string
          name?: string
          space_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scopes_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      space_admin_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          new_value: Json | null
          organization_id: string | null
          previous_value: Json | null
          request_id: string | null
          space_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          new_value?: Json | null
          organization_id?: string | null
          previous_value?: Json | null
          request_id?: string | null
          space_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_value?: Json | null
          organization_id?: string | null
          previous_value?: Json | null
          request_id?: string | null
          space_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "space_admin_audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "space_admin_audit_log_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      space_invites: {
        Row: {
          accepted_at: string | null
          accepted_by_user_id: string | null
          created_at: string
          created_by_user_id: string
          email: string
          expires_at: string
          id: string
          role_id: string
          space_id: string
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          created_at?: string
          created_by_user_id: string
          email: string
          expires_at: string
          id?: string
          role_id: string
          space_id: string
          status?: string
          token: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          created_at?: string
          created_by_user_id?: string
          email?: string
          expires_at?: string
          id?: string
          role_id?: string
          space_id?: string
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "space_invites_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "space_invites_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      space_memberships: {
        Row: {
          created_at: string
          space_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          space_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          space_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "space_memberships_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      spaces: {
        Row: {
          avatar_url: string | null
          created_at: string
          id: string
          name: string
          organization_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          name: string
          organization_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spaces_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_role: {
        Row: {
          created_at: string
          id: string
          organization_id: string | null
          role_id: string
          space_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id?: string | null
          role_id: string
          space_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string | null
          role_id?: string
          space_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_role_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_role_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_role_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      view_types: {
        Row: {
          created_at: string
          description: string | null
          is_active: boolean
          key: string
          label: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          is_active?: boolean
          key: string
          label: string
        }
        Update: {
          created_at?: string
          description?: string | null
          is_active?: boolean
          key?: string
          label?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_current_user_has_critical_capability: {
        Args: { p_capability_key: string }
        Returns: boolean
      }
      auth_user_can_access_in_space: {
        Args: { p_permission_key: string; p_space_id: string }
        Returns: boolean
      }
      auth_user_has_critical_capability: {
        Args: { p_capability_key: string; p_user_id: string }
        Returns: boolean
      }
      auth_user_has_permission: {
        Args: {
          p_organization_id?: string
          p_permission_key: string
          p_space_id?: string
        }
        Returns: boolean
      }
      ensure_outbox_queue: {
        Args: { p_queue_name: string }
        Returns: undefined
      }
      entity_id_crockford_alphabet: { Args: never; Returns: string }
      entity_id_crockford_from_bits: {
        Args: { bits: unknown }
        Returns: string
      }
      entity_id_encode_rand_16: { Args: { bytes: string }; Returns: string }
      entity_id_encode_ts_10: { Args: { ms: number }; Returns: string }
      entity_id_generate: { Args: { prefix: string }; Returns: string }
      knowledge_user_scope_ids: { Args: never; Returns: string[] }
      outbox_queue_name: { Args: { p_channel: string }; Returns: string }
      role_catalog_audit_snapshot: {
        Args: { p_role_id: string }
        Returns: Json
      }
      rpc_accept_space_invite: { Args: { p_token: string }; Returns: Json }
      rpc_archive_global_system_role: {
        Args: { p_role_id: string }
        Returns: string
      }
      rpc_archive_organization_custom_role: {
        Args: { p_role_id: string }
        Returns: string
      }
      rpc_bootstrap_initial_platform_super_admin: {
        Args: {
          p_expected_email?: string
          p_reason?: string
          p_user_id: string
        }
        Returns: Json
      }
      rpc_bootstrap_organization_and_space: {
        Args: {
          p_org_name: string
          p_org_slug: string
          p_request_id?: string
          p_space_name: string
          p_space_slug: string
        }
        Returns: Json
      }
      rpc_compact_document: {
        Args: { p_covers_seq: number; p_doc_id: string; p_snapshot: string }
        Returns: boolean
      }
      rpc_create_global_system_role: {
        Args: {
          p_description: string
          p_key: string
          p_label: string
          p_permission_keys: string[]
        }
        Returns: string
      }
      rpc_create_organization_custom_role: {
        Args: {
          p_description: string
          p_key: string
          p_label: string
          p_organization_id: string
          p_permission_keys: string[]
          p_scope: string
        }
        Returns: string
      }
      rpc_create_space_invite: {
        Args: { p_email: string; p_role_key: string; p_space_id: string }
        Returns: Json
      }
      rpc_delete_runtime_setting: {
        Args: {
          p_key?: string
          p_request_id?: string
          p_scope: string
          p_scope_id?: string
        }
        Returns: boolean
      }
      rpc_end_break_glass: { Args: { p_session_id: string }; Returns: Json }
      rpc_enqueue_body_bridge_job: {
        Args: { p_idempotency_key: string; p_node_id: string; p_payload: Json }
        Returns: Json
      }
      rpc_enqueue_outbox_job: {
        Args: {
          p_aggregate_id: string
          p_aggregate_type: string
          p_available_at?: string
          p_channel: string
          p_event_name: string
          p_event_version?: number
          p_idempotency_key?: string
          p_locale?: string
          p_operation_key?: string
          p_payload?: Json
          p_recipient?: string
          p_template_key?: string
        }
        Returns: Json
      }
      rpc_grant_platform_super_admin: {
        Args: { p_reason: string; p_target_user_id: string }
        Returns: Json
      }
      rpc_outbox_claim_jobs: {
        Args: { p_channels?: string[]; p_consumer: string; p_limit?: number }
        Returns: {
          aggregate_id: string
          aggregate_type: string
          attempt_count: number
          available_at: string
          channel: string
          claim_token: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          created_at: string
          event_name: string
          event_version: number
          id: string
          idempotency_key: string
          last_error: string | null
          locale: string | null
          operation_key: string | null
          payload: Json
          queue_message_id: number | null
          recipient: string | null
          status: string
          template_key: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "outbox_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      rpc_outbox_complete_job: {
        Args: { p_claim_token: string; p_job_id: string }
        Returns: boolean
      }
      rpc_outbox_metrics: {
        Args: {
          p_failed_since_hours?: number
          p_processing_stale_after_seconds?: number
        }
        Returns: Json
      }
      rpc_outbox_retry_job: {
        Args: {
          p_claim_token: string
          p_error?: string
          p_job_id: string
          p_retry_seconds?: number
          p_terminal?: boolean
        }
        Returns: boolean
      }
      rpc_resolve_platform_flag: {
        Args: { p_key: string; p_space_id?: string }
        Returns: boolean
      }
      rpc_revoke_platform_super_admin: {
        Args: { p_reason: string; p_target_user_id: string }
        Returns: Json
      }
      rpc_revoke_space_invite: { Args: { p_invite_id: string }; Returns: Json }
      rpc_service_role_grant_platform_super_admin: {
        Args: { p_reason?: string; p_target_user_id: string }
        Returns: Json
      }
      rpc_service_role_list_platform_super_admin_grants: {
        Args: never
        Returns: {
          granted_at: string
          granted_by_user_id: string
          reason: string
          user_id: string
        }[]
      }
      rpc_set_platform_feature_flag: {
        Args: {
          p_enabled?: boolean
          p_key?: string
          p_request_id?: string
          p_scope: string
          p_scope_id?: string
        }
        Returns: string
      }
      rpc_set_runtime_setting: {
        Args: {
          p_is_public?: boolean
          p_key?: string
          p_request_id?: string
          p_scope: string
          p_scope_id?: string
          p_value?: Json
          p_value_type?: string
        }
        Returns: string
      }
      rpc_set_space_member_role: {
        Args: {
          p_role_key: string
          p_space_id: string
          p_target_user_id: string
        }
        Returns: boolean
      }
      rpc_start_break_glass: {
        Args: {
          p_capability_key: string
          p_reason: string
          p_ttl_minutes?: number
        }
        Returns: Json
      }
      rpc_update_global_system_role: {
        Args: {
          p_description: string
          p_key: string
          p_label: string
          p_permission_keys: string[]
          p_role_id: string
        }
        Returns: string
      }
      rpc_update_organization_custom_role: {
        Args: {
          p_description: string
          p_key: string
          p_label: string
          p_permission_keys: string[]
          p_role_id: string
        }
        Returns: string
      }
      space_member_directory: {
        Args: {
          p_after_key?: string
          p_after_user?: string
          p_exclude?: string[]
          p_limit?: number
          p_query?: string
          p_space_id: string
        }
        Returns: {
          display_name: string
          email: string
          total_count: number
          user_id: string
        }[]
      }
      space_member_role_audit_snapshot: {
        Args: { p_space_id: string; p_target_user_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

