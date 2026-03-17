export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          customer_id: string
          google_sheet_link: string | null
          drive_code_comments: string | null
          enabled: boolean
          status: string
          last_run: string | null
          workflow: string
          created_date: string
        }
        Insert: {
          customer_id: string
          google_sheet_link?: string | null
          drive_code_comments?: string | null
          enabled?: boolean
          status?: string
          last_run?: string | null
          workflow?: string
          created_date?: string
        }
        Update: {
          customer_id?: string
          google_sheet_link?: string | null
          drive_code_comments?: string | null
          enabled?: boolean
          status?: string
          last_run?: string | null
          workflow?: string
          created_date?: string
        }
      }
      account_files: {
        Row: {
          id: string
          account_id: string
          file_name: string
          file_size: number | null
          mime_type: string | null
          storage_path: string
          uploaded_by: string
          created_at: string
        }
        Insert: {
          id?: string
          account_id: string
          file_name: string
          file_size?: number | null
          mime_type?: string | null
          storage_path: string
          uploaded_by: string
          created_at?: string
        }
        Update: {
          id?: string
          account_id?: string
          file_name?: string
          file_size?: number | null
          mime_type?: string | null
          storage_path?: string
          uploaded_by?: string
          created_at?: string
        }
      }
      users: {
        Row: {
          username: string
          email: string
          role: string
          department: string | null
          password_hash: string | null
          password_salt: string | null
          password: string | null
          allowed_accounts: string
          allowed_campaigns: string
          allowed_drive_folders: string
          allowed_looker_reports: string
          drive_access_level: string
          module_access: Json | null
          manager_id: string | null
          team_members: string
          avatar_data: string | null
          last_login: string | null
          email_notifications_enabled: boolean
          theme_preference: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          username: string
          email: string
          role: string
          department?: string | null
          password_hash?: string | null
          password_salt?: string | null
          password?: string | null
          allowed_accounts?: string
          allowed_campaigns?: string
          allowed_drive_folders?: string
          allowed_looker_reports?: string
          drive_access_level?: string
          module_access?: Json | null
          manager_id?: string | null
          team_members?: string
          avatar_data?: string | null
          last_login?: string | null
          email_notifications_enabled?: boolean
          theme_preference?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          username?: string
          email?: string
          role?: string
          department?: string | null
          password_hash?: string | null
          password_salt?: string | null
          password?: string | null
          allowed_accounts?: string
          allowed_campaigns?: string
          allowed_drive_folders?: string
          allowed_looker_reports?: string
          drive_access_level?: string
          module_access?: Json | null
          manager_id?: string | null
          team_members?: string
          avatar_data?: string | null
          last_login?: string | null
          email_notifications_enabled?: boolean
          theme_preference?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      departments: {
        Row: {
          id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          created_at?: string
        }
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          title: string
          body: string | null
          type: string | null
          related_id: string | null
          is_read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          body?: string | null
          type?: string | null
          related_id?: string | null
          is_read?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          body?: string | null
          type?: string | null
          related_id?: string | null
          is_read?: boolean
          created_at?: string
        }
      }
      todos: {
        Row: {
          id: string
          username: string
          title: string
          description: string | null
          our_goal: string | null
          completed: boolean
          task_status: string
          priority: string
          category: string | null
          kpi_type: string | null
          due_date: string | null
          expected_due_date: string | null
          actual_due_date: string | null
          notes: string | null
          package_name: string | null
          app_name: string | null
          position: number
          archived: boolean
          queue_department: string | null
          queue_status: string | null
          multi_assignment: Json | null
          assigned_to: string | null
          manager_id: string | null
          completed_by: string | null
          completed_at: string | null
          approval_status: string
          workflow_state: string | null
          pending_approver: string | null
          approval_chain: Json
          approval_requested_at: string | null
          approval_sla_due_at: string | null
          last_handoff_at: string | null
          approved_at: string | null
          approved_by: string | null
          declined_at: string | null
          declined_by: string | null
          decline_reason: string | null
          assignment_chain: Json
          history: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          username: string
          title: string
          description?: string | null
          our_goal?: string | null
          completed?: boolean
          task_status?: string
          priority?: string
          category?: string | null
          kpi_type?: string | null
          due_date?: string | null
          expected_due_date?: string | null
          actual_due_date?: string | null
          notes?: string | null
          package_name?: string | null
          app_name?: string | null
          position?: number
          archived?: boolean
          queue_department?: string | null
          queue_status?: string | null
          multi_assignment?: Json | null
          assigned_to?: string | null
          manager_id?: string | null
          completed_by?: string | null
          completed_at?: string | null
          approval_status?: string
          workflow_state?: string | null
          pending_approver?: string | null
          approval_chain?: Json
          approval_requested_at?: string | null
          approval_sla_due_at?: string | null
          last_handoff_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          declined_at?: string | null
          declined_by?: string | null
          decline_reason?: string | null
          assignment_chain?: Json
          history?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          username?: string
          title?: string
          description?: string | null
          our_goal?: string | null
          completed?: boolean
          task_status?: string
          priority?: string
          category?: string | null
          kpi_type?: string | null
          due_date?: string | null
          expected_due_date?: string | null
          actual_due_date?: string | null
          notes?: string | null
          package_name?: string | null
          app_name?: string | null
          position?: number
          archived?: boolean
          queue_department?: string | null
          queue_status?: string | null
          multi_assignment?: Json | null
          assigned_to?: string | null
          manager_id?: string | null
          completed_by?: string | null
          completed_at?: string | null
          approval_status?: string
          workflow_state?: string | null
          pending_approver?: string | null
          approval_chain?: Json
          approval_requested_at?: string | null
          approval_sla_due_at?: string | null
          last_handoff_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          declined_at?: string | null
          declined_by?: string | null
          decline_reason?: string | null
          assignment_chain?: Json
          history?: Json
          created_at?: string
          updated_at?: string
        }
      }
      todo_shares: {
        Row: {
          id: string
          todo_id: string
          shared_by: string
          shared_with: string
          can_edit: boolean
          created_at: string
        }
        Insert: {
          id?: string
          todo_id: string
          shared_by: string
          shared_with: string
          can_edit?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          todo_id?: string
          shared_by?: string
          shared_with?: string
          can_edit?: boolean
          created_at?: string
        }
      }
      todo_attachments: {
        Row: {
          id: string
          todo_id: string
          file_name: string
          file_size: number | null
          mime_type: string | null
          file_url: string
          storage_path: string | null
          drive_file_id: string | null
          uploaded_by: string
          created_at: string
        }
        Insert: {
          id?: string
          todo_id: string
          file_name: string
          file_size?: number | null
          mime_type?: string | null
          file_url: string
          storage_path?: string | null
          drive_file_id?: string | null
          uploaded_by: string
          created_at?: string
        }
        Update: {
          id?: string
          todo_id?: string
          file_name?: string
          file_size?: number | null
          mime_type?: string | null
          file_url?: string
          storage_path?: string | null
          drive_file_id?: string | null
          uploaded_by?: string
          created_at?: string
        }
      }
      packages: {
        Row: {
          id: string
          name: string
          description: string | null
          category: string | null
          price: number | null
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
          app_name: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          category?: string | null
          price?: number | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
          app_name?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          category?: string | null
          price?: number | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
          app_name?: string | null
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, string>
    CompositeTypes: Record<string, never>
  }
}

