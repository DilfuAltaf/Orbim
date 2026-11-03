/**
-- ORBIM — Database Schema TypeScript Definitions
-- Mirrors the PostgreSQL database foundation created in Phase 4.1.
*/

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type PlaylistVisibility = 'private' | 'shared'
export type PlaylistMemberRole = 'owner' | 'editor'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          display_name: string
          avatar_url: string | null
          location: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          display_name: string
          avatar_url?: string | null
          location?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          display_name?: string
          avatar_url?: string | null
          location?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      playlists: {
        Row: {
          id: string
          owner_id: string
          title: string
          description: string | null
          visibility: PlaylistVisibility
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id: string
          title: string
          description?: string | null
          visibility?: PlaylistVisibility
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          title?: string
          description?: string | null
          visibility?: PlaylistVisibility
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'playlists_owner_id_fkey'
            columns: ['owner_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      playlist_members: {
        Row: {
          id: string
          playlist_id: string
          user_id: string
          role: PlaylistMemberRole
          joined_at: string
        }
        Insert: {
          id?: string
          playlist_id: string
          user_id: string
          role?: PlaylistMemberRole
          joined_at?: string
        }
        Update: {
          id?: string
          playlist_id?: string
          user_id?: string
          role?: PlaylistMemberRole
          joined_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'playlist_members_playlist_id_fkey'
            columns: ['playlist_id']
            referencedRelation: 'playlists'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'playlist_members_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      playlist_tracks: {
        Row: {
          id: string
          playlist_id: string
          provider: string
          provider_track_id: string
          title: string
          artist_name: string
          album_name: string | null
          artwork_url: string | null
          duration_seconds: number
          position: number
          added_by: string | null
          added_at: string
          verification_status: 'unverified' | 'verified' | 'rejected'
          verified_by: string | null
          verified_at: string | null
          rejection_reason: string | null
          added_via: 'web_ui' | 'ai_cli' | 'bulk_import' | 'system'
          audio_url: string | null
          storage_path: string | null
          audio_source_type: 'none' | 'storage' | 'direct_stream' | 'external_url'
          catalog_track_id: string | null
        }
        Insert: {
          id?: string
          playlist_id: string
          provider?: string
          provider_track_id: string
          title: string
          artist_name: string
          album_name?: string | null
          artwork_url?: string | null
          duration_seconds?: number
          position: number
          added_by?: string | null
          added_at?: string
          verification_status?: 'unverified' | 'verified' | 'rejected'
          verified_by?: string | null
          verified_at?: string | null
          rejection_reason?: string | null
          added_via?: 'web_ui' | 'ai_cli' | 'bulk_import' | 'system'
          audio_url?: string | null
          storage_path?: string | null
          audio_source_type?: 'none' | 'storage' | 'direct_stream' | 'external_url'
          catalog_track_id?: string | null
        }
        Update: {
          id?: string
          playlist_id?: string
          provider?: string
          provider_track_id?: string
          title?: string
          artist_name?: string
          album_name?: string | null
          artwork_url?: string | null
          duration_seconds?: number
          position?: number
          added_by?: string | null
          added_at?: string
          verification_status?: 'unverified' | 'verified' | 'rejected'
          verified_by?: string | null
          verified_at?: string | null
          rejection_reason?: string | null
          added_via?: 'web_ui' | 'ai_cli' | 'bulk_import' | 'system'
          audio_url?: string | null
          storage_path?: string | null
          audio_source_type?: 'none' | 'storage' | 'direct_stream' | 'external_url'
          catalog_track_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'playlist_tracks_playlist_id_fkey'
            columns: ['playlist_id']
            referencedRelation: 'playlists'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'playlist_tracks_added_by_fkey'
            columns: ['added_by']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'playlist_tracks_verified_by_fkey'
            columns: ['verified_by']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'playlist_tracks_catalog_track_id_fkey'
            columns: ['catalog_track_id']
            referencedRelation: 'catalog_tracks'
            referencedColumns: ['id']
          },
        ]
      }
      playlist_invitations: {
        Row: {
          id: string
          playlist_id: string
          token_hash: string | null
          created_by: string
          invitee_id: string | null
          role: 'editor'
          status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'
          expires_at: string
          accepted_at: string | null
          responded_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          playlist_id: string
          token_hash?: string | null
          created_by: string
          invitee_id?: string | null
          role?: 'editor'
          status?: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'
          expires_at: string
          accepted_at?: string | null
          responded_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          playlist_id?: string
          token_hash?: string | null
          created_by?: string
          invitee_id?: string | null
          role?: 'editor'
          status?: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'
          expires_at?: string
          accepted_at?: string | null
          responded_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'playlist_invitations_playlist_id_fkey'
            columns: ['playlist_id']
            referencedRelation: 'playlists'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'playlist_invitations_created_by_fkey'
            columns: ['created_by']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'playlist_invitations_invitee_id_fkey'
            columns: ['invitee_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      app_admins: {
        Row: {
          user_id: string
          role: 'admin' | 'superadmin'
          granted_by: string | null
          created_at: string
        }
        Insert: {
          user_id: string
          role?: 'admin' | 'superadmin'
          granted_by?: string | null
          created_at?: string
        }
        Update: {
          user_id?: string
          role?: 'admin' | 'superadmin'
          granted_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'app_admins_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'app_admins_granted_by_fkey'
            columns: ['granted_by']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      app_operators: {
        Row: {
          user_id: string
          role: 'operator' | 'lead_operator'
          granted_by: string | null
          created_at: string
        }
        Insert: {
          user_id: string
          role?: 'operator' | 'lead_operator'
          granted_by?: string | null
          created_at?: string
        }
        Update: {
          user_id?: string
          role?: 'operator' | 'lead_operator'
          granted_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'app_operators_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'app_operators_granted_by_fkey'
            columns: ['granted_by']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      track_verification_audit_logs: {
        Row: {
          id: string
          track_id: string
          playlist_id: string
          action: 'verified' | 'rejected' | 'reset'
          performed_by: string
          previous_status: string
          new_status: string
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          track_id: string
          playlist_id: string
          action: 'verified' | 'rejected' | 'reset'
          performed_by: string
          previous_status: string
          new_status: string
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'track_verification_audit_logs_track_id_fkey'
            columns: ['track_id']
            referencedRelation: 'playlist_tracks'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'track_verification_audit_logs_playlist_id_fkey'
            columns: ['playlist_id']
            referencedRelation: 'playlists'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'track_verification_audit_logs_performed_by_fkey'
            columns: ['performed_by']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      catalog_tracks: {
        Row: {
          id: string
          provider: string
          provider_track_id: string
          title: string
          artist_name: string
          album_name: string | null
          artwork_url: string | null
          duration_seconds: number
          storage_path: string | null
          audio_url: string | null
          audio_source_type: 'none' | 'storage' | 'direct_stream' | 'external_url'
          publication_status: 'draft' | 'published' | 'unpublished'
          created_by: string | null
          published_by: string | null
          published_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          provider?: string
          provider_track_id: string
          title: string
          artist_name: string
          album_name?: string | null
          artwork_url?: string | null
          duration_seconds?: number
          storage_path?: string | null
          audio_url?: string | null
          audio_source_type?: 'none' | 'storage' | 'direct_stream' | 'external_url'
          publication_status?: 'draft' | 'published' | 'unpublished'
          created_by?: string | null
          published_by?: string | null
          published_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          provider?: string
          provider_track_id?: string
          title?: string
          artist_name?: string
          album_name?: string | null
          artwork_url?: string | null
          duration_seconds?: number
          storage_path?: string | null
          audio_url?: string | null
          audio_source_type?: 'none' | 'storage' | 'direct_stream' | 'external_url'
          publication_status?: 'draft' | 'published' | 'unpublished'
          created_by?: string | null
          published_by?: string | null
          published_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'catalog_tracks_created_by_fkey'
            columns: ['created_by']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'catalog_tracks_published_by_fkey'
            columns: ['published_by']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_app_admin: {
        Args: Record<string, never>
        Returns: boolean
      }
      is_app_operator: {
        Args: Record<string, never>
        Returns: boolean
      }
      can_verify_track: {
        Args: {
          p_track_id: string
        }
        Returns: boolean
      }
      verify_playlist_track: {
        Args: {
          p_track_id: string
          p_decision: 'verified' | 'rejected' | 'reset'
          p_notes?: string
        }
        Returns: {
          status: string
          track_id: string
          action: string
          new_status: string
          verified_by: string
          verified_at: string
        }
      }
      is_playlist_member: {
        Args: {
          p_playlist_id: string
        }
        Returns: boolean
      }
      is_playlist_owner: {
        Args: {
          p_playlist_id: string
        }
        Returns: boolean
      }
      accept_playlist_invitation: {
        Args: {
          p_token: string
        }
        Returns: {
          status: 'success' | 'already_member'
          playlist_id: string
          playlist_title: string
          role: string
        }
      }
      accept_playlist_invitation_by_id: {
        Args: {
          p_invitation_id: string
        }
        Returns: {
          status: 'success' | 'already_member'
          playlist_id: string
          playlist_title: string
          role: string
        }
      }
      decline_playlist_invitation: {
        Args: {
          p_invitation_id: string
        }
        Returns: {
          status: 'declined'
          invitation_id: string
        }
      }
      preview_playlist_invitation: {
        Args: {
          p_token: string
        }
        Returns: {
          valid: boolean
          status?: 'pending' | 'already_member'
          error_kind?: string
          playlist_id?: string
          playlist_title?: string
          inviter_name?: string
          role?: string
          expires_at?: string
        }
      }
      rebalance_playlist_track_positions: {
        Args: {
          p_playlist_id: string
        }
        Returns: void
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
