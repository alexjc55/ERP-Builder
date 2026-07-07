--
-- PostgreSQL database dump
--

\restrict bCgfGQfKdz0q4AAZpzajcVAbTJE8w17O4nCd9t2ksq1u9H7cYClBy7gZJ1QwwXB

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.app_settings (
    id integer DEFAULT 1 NOT NULL,
    app_name_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    subtitle_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    logo_object_path text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    currency_symbol text DEFAULT '₽'::text NOT NULL,
    default_language text DEFAULT 'ru'::text NOT NULL,
    table_style text DEFAULT 'plain'::text NOT NULL,
    table_stripe_color text,
    table_header_color text,
    table_border_color text
);


ALTER TABLE public.app_settings OWNER TO postgres;

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    entity_id integer,
    record_id integer,
    field_key text,
    old_value text,
    new_value text,
    user_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.audit_log OWNER TO postgres;

--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.audit_log_id_seq OWNER TO postgres;

--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: column_groups; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.column_groups (
    id integer NOT NULL,
    name_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    color text DEFAULT '#6366f1'::text NOT NULL,
    display_mode text DEFAULT 'bar'::text NOT NULL,
    text_color text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.column_groups OWNER TO postgres;

--
-- Name: column_groups_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.column_groups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.column_groups_id_seq OWNER TO postgres;

--
-- Name: column_groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.column_groups_id_seq OWNED BY public.column_groups.id;


--
-- Name: custom_filters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.custom_filters (
    id integer NOT NULL,
    entity_id integer NOT NULL,
    name_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    conjunction text DEFAULT 'and'::text NOT NULL,
    groups_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    inputs_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.custom_filters OWNER TO postgres;

--
-- Name: custom_filters_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.custom_filters_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.custom_filters_id_seq OWNER TO postgres;

--
-- Name: custom_filters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.custom_filters_id_seq OWNED BY public.custom_filters.id;


--
-- Name: dashboard_widgets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.dashboard_widgets (
    id integer NOT NULL,
    page_id integer NOT NULL,
    title_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    visible_role_ids_json jsonb,
    icon text DEFAULT 'bar-chart-3'::text NOT NULL,
    color text DEFAULT 'blue'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    grid_w integer DEFAULT 1 NOT NULL,
    grid_h integer DEFAULT 1 NOT NULL
);


ALTER TABLE public.dashboard_widgets OWNER TO postgres;

--
-- Name: dashboard_widgets_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.dashboard_widgets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.dashboard_widgets_id_seq OWNER TO postgres;

--
-- Name: dashboard_widgets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.dashboard_widgets_id_seq OWNED BY public.dashboard_widgets.id;


--
-- Name: deleted_files; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.deleted_files (
    id integer NOT NULL,
    entity_id integer,
    entity_name_json jsonb,
    record_id integer,
    field_key text NOT NULL,
    field_name_json jsonb,
    file_name text NOT NULL,
    file_path text NOT NULL,
    file_size integer,
    content_type text,
    reason text NOT NULL,
    deleted_by integer,
    deleted_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.deleted_files OWNER TO postgres;

--
-- Name: deleted_files_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.deleted_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.deleted_files_id_seq OWNER TO postgres;

--
-- Name: deleted_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.deleted_files_id_seq OWNED BY public.deleted_files.id;


--
-- Name: entities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.entities (
    id integer NOT NULL,
    entity_key text NOT NULL,
    name_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    description_json jsonb DEFAULT '{}'::jsonb,
    icon text DEFAULT 'table'::text NOT NULL,
    page_id integer,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    default_sort_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    pivot_enabled boolean DEFAULT false NOT NULL,
    default_filter_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    default_pivot_json jsonb,
    allow_no_status boolean DEFAULT true NOT NULL
);


ALTER TABLE public.entities OWNER TO postgres;

--
-- Name: entities_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.entities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.entities_id_seq OWNER TO postgres;

--
-- Name: entities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.entities_id_seq OWNED BY public.entities.id;


--
-- Name: entity_automation_runs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.entity_automation_runs (
    id integer NOT NULL,
    automation_id integer NOT NULL,
    entity_id integer NOT NULL,
    record_id integer,
    status text NOT NULL,
    trigger_name text,
    detail_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    dedupe_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.entity_automation_runs OWNER TO postgres;

--
-- Name: entity_automation_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.entity_automation_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.entity_automation_runs_id_seq OWNER TO postgres;

--
-- Name: entity_automation_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.entity_automation_runs_id_seq OWNED BY public.entity_automation_runs.id;


--
-- Name: entity_automations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.entity_automations (
    id integer NOT NULL,
    entity_id integer NOT NULL,
    name_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    trigger_json jsonb NOT NULL,
    conditions_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    actions_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    condition_conjunction text DEFAULT 'and'::text NOT NULL
);


ALTER TABLE public.entity_automations OWNER TO postgres;

--
-- Name: entity_automations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.entity_automations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.entity_automations_id_seq OWNER TO postgres;

--
-- Name: entity_automations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.entity_automations_id_seq OWNED BY public.entity_automations.id;


--
-- Name: entity_fields; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.entity_fields (
    id integer NOT NULL,
    entity_id integer NOT NULL,
    field_key text NOT NULL,
    name_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    description_json jsonb DEFAULT '{}'::jsonb,
    field_type text DEFAULT 'text'::text NOT NULL,
    is_required boolean DEFAULT false NOT NULL,
    default_value text,
    options_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    permissions_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_filterable boolean DEFAULT false NOT NULL,
    show_in_table boolean DEFAULT true NOT NULL,
    file_config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    format_rules_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    formula_config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    show_column_total boolean DEFAULT false NOT NULL,
    total_fill_color text,
    total_text_color text,
    dependency_config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    is_key boolean DEFAULT false NOT NULL,
    lock_after_create boolean DEFAULT false NOT NULL,
    relation_config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    pivot_enabled boolean DEFAULT false NOT NULL,
    column_group_id integer,
    validation_rules_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    wrap_text boolean DEFAULT false NOT NULL,
    default_to_today boolean DEFAULT false NOT NULL,
    percent_config_json jsonb DEFAULT '{}'::jsonb NOT NULL
);


ALTER TABLE public.entity_fields OWNER TO postgres;

--
-- Name: entity_fields_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.entity_fields_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.entity_fields_id_seq OWNER TO postgres;

--
-- Name: entity_fields_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.entity_fields_id_seq OWNED BY public.entity_fields.id;


--
-- Name: entity_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.entity_records (
    id integer NOT NULL,
    entity_id integer NOT NULL,
    values_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    status_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    status_changed_at timestamp with time zone,
    archive_exempt boolean DEFAULT false NOT NULL
);


ALTER TABLE public.entity_records OWNER TO postgres;

--
-- Name: entity_records_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.entity_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.entity_records_id_seq OWNER TO postgres;

--
-- Name: entity_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.entity_records_id_seq OWNED BY public.entity_records.id;


--
-- Name: entity_statuses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.entity_statuses (
    id integer NOT NULL,
    entity_id integer NOT NULL,
    status_key text NOT NULL,
    name_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    color text DEFAULT '#6b7280'::text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_final boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_archive_trigger boolean DEFAULT false NOT NULL,
    archive_after_days integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.entity_statuses OWNER TO postgres;

--
-- Name: entity_statuses_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.entity_statuses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.entity_statuses_id_seq OWNER TO postgres;

--
-- Name: entity_statuses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.entity_statuses_id_seq OWNED BY public.entity_statuses.id;


--
-- Name: entity_transitions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.entity_transitions (
    id integer NOT NULL,
    entity_id integer NOT NULL,
    from_status_id integer,
    to_status_id integer NOT NULL,
    name_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    allowed_role_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    required_field_keys jsonb DEFAULT '[]'::jsonb NOT NULL,
    actions_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.entity_transitions OWNER TO postgres;

--
-- Name: entity_transitions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.entity_transitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.entity_transitions_id_seq OWNER TO postgres;

--
-- Name: entity_transitions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.entity_transitions_id_seq OWNED BY public.entity_transitions.id;


--
-- Name: google_drive_connection; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.google_drive_connection (
    id integer NOT NULL,
    key_mode text DEFAULT 'builtin'::text NOT NULL,
    own_client_id text,
    own_client_secret_enc text,
    refresh_token_enc text,
    account_email text,
    folder_id text,
    folder_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.google_drive_connection OWNER TO postgres;

--
-- Name: google_drive_connection_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.google_drive_connection_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.google_drive_connection_id_seq OWNER TO postgres;

--
-- Name: google_drive_connection_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.google_drive_connection_id_seq OWNED BY public.google_drive_connection.id;


--
-- Name: google_drive_folders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.google_drive_folders (
    id integer NOT NULL,
    drive_folder_id text NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_id integer
);


ALTER TABLE public.google_drive_folders OWNER TO postgres;

--
-- Name: google_drive_folders_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.google_drive_folders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.google_drive_folders_id_seq OWNER TO postgres;

--
-- Name: google_drive_folders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.google_drive_folders_id_seq OWNED BY public.google_drive_folders.id;


--
-- Name: guest_links; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.guest_links (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token_hash text NOT NULL,
    label text,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.guest_links OWNER TO postgres;

--
-- Name: guest_links_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.guest_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.guest_links_id_seq OWNER TO postgres;

--
-- Name: guest_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.guest_links_id_seq OWNED BY public.guest_links.id;


--
-- Name: local_folders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.local_folders (
    id integer NOT NULL,
    storage_dir text NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    parent_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.local_folders OWNER TO postgres;

--
-- Name: local_folders_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.local_folders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.local_folders_id_seq OWNER TO postgres;

--
-- Name: local_folders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.local_folders_id_seq OWNED BY public.local_folders.id;


--
-- Name: login_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.login_history (
    id integer NOT NULL,
    user_id integer NOT NULL,
    ip_address text DEFAULT ''::text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.login_history OWNER TO postgres;

--
-- Name: login_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.login_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.login_history_id_seq OWNER TO postgres;

--
-- Name: login_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.login_history_id_seq OWNED BY public.login_history.id;


--
-- Name: modules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.modules (
    id integer NOT NULL,
    module_key text NOT NULL,
    name_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    version text DEFAULT '1.0.0'::text NOT NULL,
    is_enabled boolean DEFAULT false NOT NULL,
    settings_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.modules OWNER TO postgres;

--
-- Name: modules_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.modules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.modules_id_seq OWNER TO postgres;

--
-- Name: modules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.modules_id_seq OWNED BY public.modules.id;


--
-- Name: page_fields; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.page_fields (
    id integer NOT NULL,
    page_id integer NOT NULL,
    field_key text NOT NULL,
    name_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    description_json jsonb DEFAULT '{}'::jsonb,
    field_type text DEFAULT 'text'::text NOT NULL,
    is_required boolean DEFAULT false NOT NULL,
    default_value text,
    options_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    format_rules_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    show_in_table boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    formula_config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    show_column_total boolean DEFAULT false NOT NULL,
    total_fill_color text,
    total_text_color text,
    relation_config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    permissions_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    is_filterable boolean DEFAULT false NOT NULL,
    pivot_enabled boolean DEFAULT false NOT NULL,
    column_group_id integer,
    percent_config_json jsonb DEFAULT '{}'::jsonb NOT NULL
);


ALTER TABLE public.page_fields OWNER TO postgres;

--
-- Name: page_fields_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.page_fields_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.page_fields_id_seq OWNER TO postgres;

--
-- Name: page_fields_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.page_fields_id_seq OWNED BY public.page_fields.id;


--
-- Name: page_record_values; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.page_record_values (
    id integer NOT NULL,
    page_id integer NOT NULL,
    record_id integer NOT NULL,
    values_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.page_record_values OWNER TO postgres;

--
-- Name: page_record_values_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.page_record_values_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.page_record_values_id_seq OWNER TO postgres;

--
-- Name: page_record_values_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.page_record_values_id_seq OWNED BY public.page_record_values.id;


--
-- Name: pages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pages (
    id integer NOT NULL,
    name_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    description_json jsonb DEFAULT '{}'::jsonb,
    icon text DEFAULT 'file'::text NOT NULL,
    parent_page_id integer,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    path text,
    mirror_entity_id integer,
    mirror_field_keys_json jsonb,
    is_dashboard boolean DEFAULT false NOT NULL,
    widgets_collapsed_default boolean DEFAULT false NOT NULL,
    mirror_field_labels_json jsonb,
    is_pivot boolean DEFAULT false NOT NULL,
    pivot_entity_id integer,
    pivot_config_json jsonb,
    mirror_column_order_json jsonb,
    column_groups_json jsonb,
    default_quick_filter_json jsonb,
    group_by_field_key text,
    mirror_pinned_json jsonb,
    group_default_expanded boolean DEFAULT false NOT NULL
);


ALTER TABLE public.pages OWNER TO postgres;

--
-- Name: pages_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pages_id_seq OWNER TO postgres;

--
-- Name: pages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.pages_id_seq OWNED BY public.pages.id;


--
-- Name: record_links; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.record_links (
    id integer NOT NULL,
    relation_id integer NOT NULL,
    relation_type text NOT NULL,
    source_record_id integer NOT NULL,
    target_record_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.record_links OWNER TO postgres;

--
-- Name: record_links_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.record_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.record_links_id_seq OWNER TO postgres;

--
-- Name: record_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.record_links_id_seq OWNED BY public.record_links.id;


--
-- Name: relations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.relations (
    id integer NOT NULL,
    source_entity_id integer NOT NULL,
    target_entity_id integer NOT NULL,
    relation_key text NOT NULL,
    relation_type text DEFAULT 'one_to_many'::text NOT NULL,
    name_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    inverse_name_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    settings_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.relations OWNER TO postgres;

--
-- Name: relations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.relations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.relations_id_seq OWNER TO postgres;

--
-- Name: relations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.relations_id_seq OWNED BY public.relations.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    name_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    description_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    permissions_json jsonb DEFAULT '{"admin": {"pages": false, "roles": false, "users": false, "events": false, "modules": false, "entities": false, "settings": false, "dataImport": false, "automations": false, "googleDrive": false, "columnGroups": false, "translations": false, "customFilters": false}, "pageIds": [], "records": {}, "superAdmin": false}'::jsonb NOT NULL
);


ALTER TABLE public.roles OWNER TO postgres;

--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.roles_id_seq OWNER TO postgres;

--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: system_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.system_events (
    id integer NOT NULL,
    event_name text NOT NULL,
    entity_id integer,
    record_id integer,
    payload_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.system_events OWNER TO postgres;

--
-- Name: system_events_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.system_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.system_events_id_seq OWNER TO postgres;

--
-- Name: system_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.system_events_id_seq OWNED BY public.system_events.id;


--
-- Name: translations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.translations (
    id integer NOT NULL,
    translation_key text NOT NULL,
    translations_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.translations OWNER TO postgres;

--
-- Name: translations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.translations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.translations_id_seq OWNER TO postgres;

--
-- Name: translations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.translations_id_seq OWNED BY public.translations.id;


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_roles (
    user_id integer NOT NULL,
    role_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_roles OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email text NOT NULL,
    password_hash text,
    first_name text NOT NULL,
    last_name text NOT NULL,
    role_id integer NOT NULL,
    language text DEFAULT 'ru'::text NOT NULL,
    direction text DEFAULT 'ltr'::text NOT NULL,
    start_page_id integer,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: views; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.views (
    id integer NOT NULL,
    entity_id integer NOT NULL,
    view_key text NOT NULL,
    name_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    visible_role_ids_json jsonb
);


ALTER TABLE public.views OWNER TO postgres;

--
-- Name: views_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.views_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.views_id_seq OWNER TO postgres;

--
-- Name: views_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.views_id_seq OWNED BY public.views.id;


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: column_groups id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.column_groups ALTER COLUMN id SET DEFAULT nextval('public.column_groups_id_seq'::regclass);


--
-- Name: custom_filters id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.custom_filters ALTER COLUMN id SET DEFAULT nextval('public.custom_filters_id_seq'::regclass);


--
-- Name: dashboard_widgets id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dashboard_widgets ALTER COLUMN id SET DEFAULT nextval('public.dashboard_widgets_id_seq'::regclass);


--
-- Name: deleted_files id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deleted_files ALTER COLUMN id SET DEFAULT nextval('public.deleted_files_id_seq'::regclass);


--
-- Name: entities id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entities ALTER COLUMN id SET DEFAULT nextval('public.entities_id_seq'::regclass);


--
-- Name: entity_automation_runs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_automation_runs ALTER COLUMN id SET DEFAULT nextval('public.entity_automation_runs_id_seq'::regclass);


--
-- Name: entity_automations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_automations ALTER COLUMN id SET DEFAULT nextval('public.entity_automations_id_seq'::regclass);


--
-- Name: entity_fields id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_fields ALTER COLUMN id SET DEFAULT nextval('public.entity_fields_id_seq'::regclass);


--
-- Name: entity_records id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_records ALTER COLUMN id SET DEFAULT nextval('public.entity_records_id_seq'::regclass);


--
-- Name: entity_statuses id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_statuses ALTER COLUMN id SET DEFAULT nextval('public.entity_statuses_id_seq'::regclass);


--
-- Name: entity_transitions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_transitions ALTER COLUMN id SET DEFAULT nextval('public.entity_transitions_id_seq'::regclass);


--
-- Name: google_drive_connection id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.google_drive_connection ALTER COLUMN id SET DEFAULT nextval('public.google_drive_connection_id_seq'::regclass);


--
-- Name: google_drive_folders id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.google_drive_folders ALTER COLUMN id SET DEFAULT nextval('public.google_drive_folders_id_seq'::regclass);


--
-- Name: guest_links id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.guest_links ALTER COLUMN id SET DEFAULT nextval('public.guest_links_id_seq'::regclass);


--
-- Name: local_folders id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.local_folders ALTER COLUMN id SET DEFAULT nextval('public.local_folders_id_seq'::regclass);


--
-- Name: login_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.login_history ALTER COLUMN id SET DEFAULT nextval('public.login_history_id_seq'::regclass);


--
-- Name: modules id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.modules ALTER COLUMN id SET DEFAULT nextval('public.modules_id_seq'::regclass);


--
-- Name: page_fields id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.page_fields ALTER COLUMN id SET DEFAULT nextval('public.page_fields_id_seq'::regclass);


--
-- Name: page_record_values id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.page_record_values ALTER COLUMN id SET DEFAULT nextval('public.page_record_values_id_seq'::regclass);


--
-- Name: pages id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages ALTER COLUMN id SET DEFAULT nextval('public.pages_id_seq'::regclass);


--
-- Name: record_links id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.record_links ALTER COLUMN id SET DEFAULT nextval('public.record_links_id_seq'::regclass);


--
-- Name: relations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.relations ALTER COLUMN id SET DEFAULT nextval('public.relations_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: system_events id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_events ALTER COLUMN id SET DEFAULT nextval('public.system_events_id_seq'::regclass);


--
-- Name: translations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.translations ALTER COLUMN id SET DEFAULT nextval('public.translations_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: views id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.views ALTER COLUMN id SET DEFAULT nextval('public.views_id_seq'::regclass);


--
-- Data for Name: app_settings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.app_settings (id, app_name_json, subtitle_json, logo_object_path, updated_at, currency_symbol, default_language, table_style, table_stripe_color, table_header_color, table_border_color) FROM stdin;
1	{"ru": "Davidov & Co. Ltd"}	{"ru": "Metal engineering works"}	/objects/uploads/108bdc57-65e2-4e63-8700-0ee23faf5190	2026-07-06 08:21:37.107+00	₪	ru	striped_bold	#f1f5ff	#d9e1f2	#879bc5
\.


--
-- Data for Name: audit_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.audit_log (id, entity_id, record_id, field_key, old_value, new_value, user_id, created_at) FROM stdin;
246	72	130	project_manager	\N	2	20	2026-06-10 15:25:16.837183+00
247	72	130	client	\N	22	20	2026-06-10 15:25:16.837183+00
248	72	130	project_name	\N	Улица така-то	20	2026-06-10 15:25:16.837183+00
249	72	130	item_name	\N	Изделие 0001	20	2026-06-10 15:25:16.837183+00
250	72	130	order_number	\N	3056	20	2026-06-10 15:25:16.837183+00
251	72	130	drawing_link	\N	{"kind":"gdrive","fileId":"17qypSPH8J1eF8DqMkh3PJs2g4D4pB7MJ","name":"מעקה מרפסת קומה 7 תכנון 19.11.pdf","contentType":"application/pdf","size":1500425,"webViewLink":"https://drive.google.com/file/d/17qypSPH8J1eF8DqMkh3PJs2g4D4pB7MJ/view?usp=drivesdk"}	20	2026-06-10 15:25:16.837183+00
252	72	130	ral_color	\N	654	20	2026-06-10 15:25:16.837183+00
253	72	130	quantity	\N	11.1	20	2026-06-10 15:25:16.837183+00
254	72	130	client_unit_price	\N	50	20	2026-06-10 15:25:16.837183+00
255	72	130	client_total_price	\N	343	20	2026-06-10 15:25:16.837183+00
256	72	130	materials_cost	\N	232534	20	2026-06-10 15:25:16.837183+00
257	72	130	__status__	\N	50	20	2026-06-10 15:25:16.837183+00
258	72	130	__deleted__	{"client":22,"quantity":11.1,"item_name":"Изделие 0001","ral_color":"654","drawing_link":{"kind":"gdrive","name":"מעקה מרפסת קומה 7 תכנון 19.11.pdf","size":1500425,"fileId":"17qypSPH8J1eF8DqMkh3PJs2g4D4pB7MJ","contentType":"application/pdf","webViewLink":"https://drive.google.com/file/d/17qypSPH8J1eF8DqMkh3PJs2g4D4pB7MJ/view?usp=drivesdk"},"order_number":"3056","project_name":"Улица така-то","materials_cost":232534,"project_manager":2,"client_unit_price":50,"client_total_price":343}	\N	1	2026-06-10 15:26:44.202505+00
259	72	131	project_manager	\N	2	1	2026-06-10 17:53:24.404676+00
260	72	131	client	\N	22	1	2026-06-10 17:53:24.404676+00
261	72	131	project_name	\N	test	1	2026-06-10 17:53:24.404676+00
262	72	131	item_name	\N	tttest	1	2026-06-10 17:53:24.404676+00
263	72	131	order_number	\N	3333	1	2026-06-10 17:53:24.404676+00
264	72	131	drawing_link	\N	{"kind":"gdrive","fileId":"1oQQdbCOSYMfphCEXjlD39x64XKKvF4DK","name":"מעקה מרפסת קומה 7 תכנון 19.11.pdf","contentType":"application/pdf","size":1500425,"webViewLink":"https://drive.google.com/file/d/1oQQdbCOSYMfphCEXjlD39x64XKKvF4DK/view?usp=drivesdk"}	1	2026-06-10 17:53:24.404676+00
265	72	131	__status__	\N	50	1	2026-06-10 17:53:24.404676+00
266	72	132	project_manager	\N	2	1	2026-06-10 17:59:15.762963+00
267	72	132	client	\N	22	1	2026-06-10 17:59:15.762963+00
268	72	132	project_name	\N	test	1	2026-06-10 17:59:15.762963+00
269	72	132	order_number	\N	3333	1	2026-06-10 17:59:15.762963+00
270	72	132	__status__	\N	50	1	2026-06-10 17:59:15.762963+00
271	72	132	__deleted__	{"client":22,"order_number":"3333","project_name":"test","project_manager":2}	\N	1	2026-06-10 17:59:22.491219+00
272	72	131	__deleted__	{"client":22,"item_name":"tttest","drawing_link":{"kind":"gdrive","name":"מעקה מרפסת קומה 7 תכנון 19.11.pdf","size":1500425,"fileId":"1oQQdbCOSYMfphCEXjlD39x64XKKvF4DK","contentType":"application/pdf","webViewLink":"https://drive.google.com/file/d/1oQQdbCOSYMfphCEXjlD39x64XKKvF4DK/view?usp=drivesdk"},"order_number":"3333","project_name":"test","project_manager":2}	\N	1	2026-06-10 17:59:27.084682+00
273	72	133	project_manager	\N	2	1	2026-06-10 19:12:02.172053+00
274	72	133	client	\N	22	1	2026-06-10 19:12:02.172053+00
275	72	133	project_name	\N	2353	1	2026-06-10 19:12:02.172053+00
276	72	133	order_number	\N	фыоарывлаы	1	2026-06-10 19:12:02.172053+00
277	72	133	__status__	\N	50	1	2026-06-10 19:12:02.172053+00
278	72	133	__deleted__	{"client":22,"order_number":"фыоарывлаы","project_name":"2353","project_manager":2}	\N	1	2026-06-10 19:13:03.512763+00
279	72	134	project_manager	\N	2	1	2026-06-10 19:13:32.87646+00
280	72	134	client	\N	22	1	2026-06-10 19:13:32.87646+00
281	72	134	project_name	\N	апропор	1	2026-06-10 19:13:32.87646+00
282	72	134	item_name	\N	оаорол	1	2026-06-10 19:13:32.87646+00
283	72	134	order_number	\N	6546	1	2026-06-10 19:13:32.87646+00
284	72	134	__status__	\N	50	1	2026-06-10 19:13:32.87646+00
285	72	134	project_name	апропор	апропор543	1	2026-06-10 19:13:47.012018+00
286	72	134	order_number	6546	6542	1	2026-06-10 19:13:57.141348+00
287	72	135	project_manager	\N	2	1	2026-06-10 19:14:09.315493+00
288	72	135	client	\N	22	1	2026-06-10 19:14:09.315493+00
289	72	135	project_name	\N	апропор543	1	2026-06-10 19:14:09.315493+00
290	72	135	order_number	\N	6542	1	2026-06-10 19:14:09.315493+00
291	72	135	__status__	\N	50	1	2026-06-10 19:14:09.315493+00
292	72	135	__deleted__	{"client":22,"order_number":"6542","project_name":"апропор543","project_manager":2}	\N	1	2026-06-10 19:14:19.707134+00
293	72	134	__deleted__	{"client":22,"item_name":"оаорол","order_number":"6542","project_name":"апропор543","project_manager":2}	\N	1	2026-06-10 19:14:23.814+00
294	72	136	project_manager	\N	2	1	2026-06-11 13:29:59.979997+00
295	72	136	client	\N	22	1	2026-06-11 13:29:59.979997+00
296	72	136	project_name	\N	435	1	2026-06-11 13:29:59.979997+00
297	72	136	item_name	\N	рпп	1	2026-06-11 13:29:59.979997+00
298	72	136	order_number	\N	4534	1	2026-06-11 13:29:59.979997+00
299	72	136	__status__	\N	50	1	2026-06-11 13:29:59.979997+00
300	72	136	__deleted__	{"client":22,"item_name":"рпп","order_number":4534,"project_name":"435","project_manager":2}	\N	1	2026-06-11 13:30:13.783618+00
301	72	137	project_manager	\N	2	1	2026-06-11 14:20:03.583577+00
302	72	137	client	\N	22	1	2026-06-11 14:20:03.583577+00
303	72	137	project_name	\N	апрпр	1	2026-06-11 14:20:03.583577+00
304	72	137	item_name	\N	ывфвва	1	2026-06-11 14:20:03.583577+00
305	72	137	order_number	\N	5654	1	2026-06-11 14:20:03.583577+00
306	72	137	drawing	\N	{"kind":"gdrive","fileId":"1m51oaYg80mKVpWKMGgjfPR0IygwZLnfS","name":"מעקה מרפסת קומה 7 תכנון 19.11.pdf","contentType":"application/pdf","size":1500425,"webViewLink":"https://drive.google.com/file/d/1m51oaYg80mKVpWKMGgjfPR0IygwZLnfS/view?usp=drivesdk"}	1	2026-06-11 14:20:03.583577+00
307	72	137	__status__	\N	50	1	2026-06-11 14:20:03.583577+00
308	72	137	__deleted__	{"client":22,"drawing":{"kind":"gdrive","name":"מעקה מרפסת קומה 7 תכנון 19.11.pdf","size":1500425,"fileId":"1m51oaYg80mKVpWKMGgjfPR0IygwZLnfS","contentType":"application/pdf","webViewLink":"https://drive.google.com/file/d/1m51oaYg80mKVpWKMGgjfPR0IygwZLnfS/view?usp=drivesdk"},"item_name":"ывфвва","order_number":"5654","project_name":"апрпр","project_manager":2}	\N	1	2026-06-11 14:20:19.497631+00
309	72	138	project_manager	\N	2	1	2026-06-11 15:33:07.329135+00
310	72	138	client	\N	22	1	2026-06-11 15:33:07.329135+00
311	72	138	project_name	\N	hjgjh	1	2026-06-11 15:33:07.329135+00
312	72	138	item_name	\N	jkhkj	1	2026-06-11 15:33:07.329135+00
313	72	138	order_number	\N	5646	1	2026-06-11 15:33:07.329135+00
314	72	138	drawing	\N	{"kind":"gdrive","fileId":"1Ux7_2T9HwouCU0kd-TAQz5Si_fYGm9WG","name":"מעקה מרפסת קומה 7 תכנון 19.11.pdf","contentType":"application/pdf","size":1500425,"webViewLink":"https://drive.google.com/file/d/1Ux7_2T9HwouCU0kd-TAQz5Si_fYGm9WG/view?usp=drivesdk"}	1	2026-06-11 15:33:07.329135+00
315	72	138	quantity	\N	11.6	1	2026-06-11 15:33:07.329135+00
316	72	138	unit_price	\N	400	1	2026-06-11 15:33:07.329135+00
317	72	138	__status__	\N	50	1	2026-06-11 15:33:07.329135+00
318	72	139	project_manager	\N	2	1	2026-06-11 15:35:17.909592+00
319	72	139	client	\N	22	1	2026-06-11 15:35:17.909592+00
320	72	139	project_name	\N	hjgjh	1	2026-06-11 15:35:17.909592+00
321	72	139	item_name	\N	hfghg	1	2026-06-11 15:35:17.909592+00
322	72	139	order_number	\N	5646	1	2026-06-11 15:35:17.909592+00
323	72	139	drawing	\N	{"kind":"gdrive","fileId":"1mGm6DF-3YbWBMywzeuJiKasnDuiDB3oq","name":"מעקה מרפסת קומה 7 תכנון 19.11.pdf","contentType":"application/pdf","size":1500425,"webViewLink":"https://drive.google.com/file/d/1mGm6DF-3YbWBMywzeuJiKasnDuiDB3oq/view?usp=drivesdk"}	1	2026-06-11 15:35:17.909592+00
324	72	139	quantity	\N	12	1	2026-06-11 15:35:17.909592+00
325	72	139	unit_price	\N	500	1	2026-06-11 15:35:17.909592+00
326	72	139	__status__	\N	50	1	2026-06-11 15:35:17.909592+00
327	72	138	quantity	11.6	\N	1	2026-06-11 15:36:07.260599+00
328	72	138	quantity	\N	11.6	1	2026-06-11 15:36:14.688857+00
329	72	139	quantity	12	12.2	1	2026-06-11 15:39:07.434333+00
330	72	138	quantity	11.6	11.63	1	2026-06-11 15:50:29.923572+00
331	72	138	unit_price	400	403	1	2026-06-11 15:50:39.311291+00
332	72	138	quantity	11.63	11.636	1	2026-06-11 15:50:54.737587+00
333	72	138	unit_price	403	403.56	1	2026-06-11 15:51:10.153917+00
334	72	138	unit_price	403.56	403.562	1	2026-06-11 15:51:19.279696+00
335	72	139	__deleted__	{"client":22,"drawing":{"kind":"gdrive","name":"מעקה מרפסת קומה 7 תכנון 19.11.pdf","size":1500425,"fileId":"1mGm6DF-3YbWBMywzeuJiKasnDuiDB3oq","contentType":"application/pdf","webViewLink":"https://drive.google.com/file/d/1mGm6DF-3YbWBMywzeuJiKasnDuiDB3oq/view?usp=drivesdk"},"quantity":12.2,"item_name":"hfghg","unit_price":500,"order_number":"5646","project_name":"hjgjh","project_manager":2}	\N	1	2026-06-12 07:52:38.619528+00
336	72	138	__deleted__	{"client":22,"drawing":{"kind":"gdrive","name":"מעקה מרפסת קומה 7 תכנון 19.11.pdf","size":1500425,"fileId":"1Ux7_2T9HwouCU0kd-TAQz5Si_fYGm9WG","contentType":"application/pdf","webViewLink":"https://drive.google.com/file/d/1Ux7_2T9HwouCU0kd-TAQz5Si_fYGm9WG/view?usp=drivesdk"},"quantity":11.636,"item_name":"jkhkj","unit_price":403.562,"order_number":"5646","project_name":"hjgjh","project_manager":2}	\N	1	2026-06-12 07:52:40.678718+00
337	73	140	name	\N	Новый Проект	1	2026-06-12 19:37:07.159364+00
338	73	140	client	\N	22	1	2026-06-12 19:37:07.159364+00
339	73	141	name	\N	Еще один	1	2026-06-12 19:37:52.440054+00
340	73	141	client	\N	22	1	2026-06-12 19:37:52.440054+00
341	73	142	name	\N	и еще	1	2026-06-12 19:42:27.475919+00
342	73	142	client	\N	22	1	2026-06-12 19:42:27.475919+00
343	73	143	name	\N	вот еще один	1	2026-06-12 19:47:13.910663+00
344	73	143	client	\N	22	1	2026-06-12 19:47:13.910663+00
345	73	144	name	\N	тут проект	1	2026-06-12 19:52:55.956907+00
346	73	144	client	\N	22	1	2026-06-12 19:52:55.956907+00
347	73	145	name	\N	А сейчас я добавлю проект с очень длинным названием чтоб понять что будет если он такой	1	2026-06-12 19:54:52.566619+00
348	73	145	client	\N	22	1	2026-06-12 19:54:52.566619+00
349	74	146	order_number	\N	3611	1	2026-06-14 06:00:43.401112+00
350	74	146	order_file	\N	{"kind":"link","url":"https://docs.google.com/document/d/1N5q1u-b57fWg6iJsbfJscJ17w-ZTCtUEI_5kyI4gKVI"}	1	2026-06-14 06:00:43.401112+00
351	74	146	drawing	\N	{"kind":"link","url":"https://drive.google.com/file/d/1HB2LM0tYkc9WMxIj3pyBqiCbfcSYlZoB"}	1	2026-06-14 06:00:43.401112+00
352	74	146	dwg_drawings	\N	{"kind":"link","url":"https://drive.google.com/file/d/1JQ8D8ygpY1NYz_caPHmRKcFojvVWW0mD"}	1	2026-06-14 06:00:43.401112+00
353	74	146	designer	\N	23	1	2026-06-14 06:00:43.401112+00
354	74	146	production_date	\N	2026-02-24	1	2026-06-14 06:00:43.401112+00
355	74	146	manufacturer	\N	14	1	2026-06-14 06:00:43.401112+00
356	74	146	production_order	\N	{"kind":"link","url":"https://docs.google.com/document/d/1X9_5-eAmCG9YUzePJK2kb1yvQkaiOBL1okgT69SZmZ0"}	1	2026-06-14 06:00:43.401112+00
357	74	146	painter	\N	צביע באפוקול	1	2026-06-14 06:00:43.401112+00
358	74	146	painting_order	\N	{"kind":"link","url":"https://docs.google.com/document/d/1hSLn9thCpasplaDpnihJyHiNdkX-Tw3AWc8sKlsYa1g"}	1	2026-06-14 06:00:43.401112+00
359	72	147	project_manager	\N	2	1	2026-06-14 06:03:02.018311+00
360	72	147	client	\N	22	1	2026-06-14 06:03:02.018311+00
361	72	147	item_name	\N	изделие 1	1	2026-06-14 06:03:02.018311+00
362	72	147	drawing	\N	{"kind":"link","url":"https://docs.google.com/document/d/1hSLn9thCpasplaDpnihJyHiNdkX-Tw3AWc8sKlsYa1g"}	1	2026-06-14 06:03:02.018311+00
363	72	147	__status__	\N	50	1	2026-06-14 06:03:02.018311+00
364	72	147	drawing	{"url":"https://docs.google.com/document/d/1hSLn9thCpasplaDpnihJyHiNdkX-Tw3AWc8sKlsYa1g","kind":"link"}	{"url":"https://drive.google.com/file/d/1HB2LM0tYkc9WMxIj3pyBqiCbfcSYlZoB","kind":"link"}	1	2026-06-14 06:04:58.385096+00
365	72	147	__deleted__	{"client":22,"drawing":{"url":"https://drive.google.com/file/d/1HB2LM0tYkc9WMxIj3pyBqiCbfcSYlZoB","kind":"link"},"item_name":"изделие 1","project_manager":2}	\N	1	2026-06-14 06:34:33.467721+00
366	72	148	project_manager	\N	2	1	2026-06-14 06:53:16.813543+00
367	72	148	client	\N	22	1	2026-06-14 06:53:16.813543+00
368	72	148	item_name	\N	аа	1	2026-06-14 06:53:16.813543+00
369	72	148	__status__	\N	50	1	2026-06-14 06:53:16.813543+00
370	72	148	quantity	\N	11.6	1	2026-06-14 07:04:38.267844+00
371	72	148	unit_price	\N	300	1	2026-06-14 07:04:42.531476+00
372	72	148	mnf_cost_unit	\N	150	1	2026-06-14 07:04:54.293588+00
373	72	149	project_manager	\N	2	1	2026-06-14 09:27:12.22098+00
374	72	149	client	\N	22	1	2026-06-14 09:27:12.22098+00
375	72	149	item_name	\N	тест	1	2026-06-14 09:27:12.22098+00
376	72	149	quantity	\N	12	1	2026-06-14 09:27:12.22098+00
377	72	149	unit_price	\N	134	1	2026-06-14 09:27:12.22098+00
378	72	149	designer_cost	\N	8	1	2026-06-14 09:27:12.22098+00
379	72	149	mnf_cost_unit	\N	11	1	2026-06-14 09:27:12.22098+00
380	72	149	__status__	\N	50	1	2026-06-14 09:27:12.22098+00
381	72	149	__deleted__	{"client":22,"quantity":12,"item_name":"тест","unit_price":134,"designer_cost":8,"mnf_cost_unit":11,"project_manager":2}	\N	1	2026-06-14 10:03:54.60126+00
382	74	146	painter	צביע באפוקול	צבוע אצל יצרן	1	2026-06-14 14:58:46.747785+00
383	74	146	painter	צבוע אצל יצרן	ללא צבע	1	2026-06-14 14:58:53.246195+00
384	74	146	painter	ללא צבע	צביע באפוקול	1	2026-06-14 14:58:59.316516+00
385	72	148	item_name	аа	ааа	14	2026-06-15 14:30:33.885512+00
386	72	148	project_manager	2	20	1	2026-06-15 14:40:42.076046+00
387	72	148	project_manager	20	21	1	2026-06-15 14:41:23.384801+00
388	72	148	project_manager	21	2	1	2026-06-15 14:41:54.8022+00
389	72	148	project_manager	2	21	1	2026-06-15 14:47:48.71784+00
390	72	148	project_manager	21	20	1	2026-06-15 14:47:51.224449+00
391	72	148	project_manager	20	2	1	2026-06-15 14:47:53.401909+00
392	72	148	__status__	50	\N	14	2026-06-16 09:37:30.620961+00
393	72	148	__status__	\N	50	14	2026-06-16 09:37:34.74477+00
394	72	148	__status__	50	51	14	2026-06-16 09:37:37.347248+00
395	72	148	__status__	51	52	14	2026-06-16 09:37:39.715722+00
396	72	148	__status__	52	50	14	2026-06-16 09:37:41.577569+00
397	72	148	__status__	50	51	1	2026-06-16 09:38:56.320241+00
398	72	148	__status__	51	50	1	2026-06-16 09:39:00.839806+00
399	72	148	__status__	50	51	1	2026-06-17 10:48:09.959013+00
400	72	148	quantity	11.6	11.7	1	2026-06-17 10:48:22.872581+00
401	73	145	__deleted__	{"name":"А сейчас я добавлю проект с очень длинным названием чтоб понять что будет если он такой","client":22}	\N	1	2026-06-19 09:11:08.057876+00
402	74	146	painter	צביע באפוקול	צבוע אצל יצרן	1	2026-06-19 12:14:08.892272+00
403	74	146	painter	צבוע אצל יצרן	צביע באפוקול	1	2026-06-19 15:04:19.80665+00
404	72	148	paint_status	\N	צביע באפוקול	1	2026-06-19 15:04:19.850005+00
405	72	148	paint_status	צביע באפוקול	\N	1	2026-06-19 15:04:30.073687+00
406	72	150	project_manager	\N	21	1	2026-06-21 20:06:08.764897+00
407	72	150	client	\N	22	1	2026-06-21 20:06:08.764897+00
408	72	150	item_name	\N	еарпор	1	2026-06-21 20:06:08.764897+00
409	72	150	quantity	\N	11	1	2026-06-21 20:06:08.764897+00
410	72	150	unit_price	\N	200	1	2026-06-21 20:06:08.764897+00
411	72	150	__status__	\N	50	1	2026-06-21 20:06:08.764897+00
412	72	150	mnf_cost_unit	\N	100	1	2026-06-21 20:11:10.853064+00
413	72	151	project_manager	\N	20	1	2026-06-21 20:59:06.936578+00
414	72	151	client	\N	22	1	2026-06-21 20:59:06.936578+00
415	72	151	item_name	\N	рпап	1	2026-06-21 20:59:06.936578+00
416	72	151	quantity	\N	13	1	2026-06-21 20:59:06.936578+00
417	72	151	unit_price	\N	450	1	2026-06-21 20:59:06.936578+00
418	72	151	mnf_cost_unit	\N	210	1	2026-06-21 20:59:06.936578+00
419	72	151	paint_finish_date	\N	2222-11-11	1	2026-06-21 20:59:06.936578+00
420	72	151	__status__	\N	50	1	2026-06-21 20:59:06.936578+00
421	72	151	production_status	\N	בחיתוך	1	2026-06-22 11:24:49.188718+00
422	72	151	production_status	בחיתוך	בריתוך	1	2026-06-22 11:24:54.100568+00
423	72	151	production_status	בריתוך	בחיתוך	1	2026-06-22 11:24:57.075045+00
424	72	151	production_status	בחיתוך	בריתוך	1	2026-06-22 11:25:41.914065+00
425	72	151	production_status	בריתוך	בפינישים	1	2026-06-22 11:25:44.10593+00
426	72	151	production_status	בפינישים	בגילוון	1	2026-06-22 11:25:46.189735+00
427	72	151	production_status	בגילוון	בצביעה	1	2026-06-22 11:25:48.307659+00
428	72	151	production_status	בצביעה	מוכן לבדיקה	1	2026-06-22 11:25:50.402267+00
429	72	151	production_status	מוכן לבדיקה	מוכן לאיציה לישראל	1	2026-06-22 11:25:52.810798+00
430	72	151	production_status	מוכן לאיציה לישראל	מוכפא	1	2026-06-22 11:25:54.821255+00
431	72	151	production_status	מוכפא	יצאיה לישראל	1	2026-06-22 11:25:56.980943+00
432	72	151	production_status	יצאיה לישראל	עוד לא בעבודה	1	2026-06-22 11:25:58.918801+00
433	72	151	production_status	עוד לא בעבודה	לפני צבע	1	2026-06-22 11:26:02.263908+00
434	72	151	production_status	לפני צבע	לא לביצוע	1	2026-06-22 11:26:04.293557+00
435	72	151	production_status	לא לביצוע	בחיתוך	1	2026-06-22 11:26:06.515699+00
436	72	151	production_status	בחיתוך	בריתוך	1	2026-06-22 13:39:24.090611+00
437	72	151	production_status	בריתוך	בחיתוך	1	2026-06-22 13:39:28.763127+00
438	72	151	production_status	בחיתוך	בריתוך	1	2026-06-22 13:40:18.743239+00
439	72	151	production_status	בריתוך	עוד לא בעבודה	1	2026-06-22 13:40:20.604674+00
440	72	151	production_status	עוד לא בעבודה	מוכן לאיציה לישראל	1	2026-06-22 13:40:22.677516+00
441	72	151	production_status	מוכן לאיציה לישראל	בגילוון	1	2026-06-22 13:40:25.214908+00
442	72	151	production_status	בגילוון	בחיתוך	1	2026-06-22 13:40:27.939157+00
443	72	151	production_status	בחיתוך	מוכן לבדיקה	1	2026-06-22 13:40:54.771363+00
444	72	150	production_status	\N	לא לביצוע	1	2026-06-22 13:41:03.011916+00
445	72	150	production_status	לא לביצוע	מוכן לבדיקה	1	2026-06-22 13:41:06.337712+00
446	72	150	production_status	מוכן לבדיקה	בצביעה	1	2026-06-22 13:41:08.280388+00
447	72	150	production_status	בצביעה	מוכן לאיציה לישראל	1	2026-06-22 13:41:10.060873+00
448	72	148	production_status	\N	מוכפא	1	2026-06-22 13:41:13.183585+00
449	72	151	comments	\N	מאושר לאיציה	1	2026-06-22 17:02:24.087854+00
450	72	148	comments	\N	דחוף מאוד	1	2026-06-22 17:02:28.333984+00
451	72	150	comments	\N	מוקפא	1	2026-06-22 17:02:31.613454+00
452	72	150	comments	מוקפא	לא מאושר	1	2026-06-22 17:02:34.562272+00
453	72	151	production_finish_date	\N	2026-06-22	1	2026-06-22 17:02:45.816358+00
454	72	151	material_release_date	\N	2026-06-23	1	2026-06-22 17:03:01.60896+00
455	72	151	paint_status	\N	בצבע	1	2026-06-22 17:03:20.744569+00
456	72	150	paint_status	\N	מוכן להובלה	1	2026-06-22 17:03:26.184532+00
457	72	148	paint_status	\N	יצאה חלקי	1	2026-06-22 17:03:29.815766+00
458	72	150	paint_finish_date	\N	2026-06-22	1	2026-06-22 17:03:41.274222+00
459	72	148	paint_finish_date	\N	2026-06-26	1	2026-06-22 17:03:48.041511+00
460	72	151	comments	מאושר לאיציה	חובה וידיו	1	2026-06-23 06:36:24.752626+00
461	72	151	comments	חובה וידיו	דחוף מאוד	1	2026-06-23 06:36:27.68326+00
462	72	151	comments	דחוף מאוד	מאושר לאיציה	1	2026-06-23 06:53:27.166536+00
463	72	151	production_status	מוכן לבדיקה	יצאיה לישראל	1	2026-06-23 06:56:15.423466+00
464	72	148	production_status	מוכפא	יצאיה לישראל	1	2026-06-23 14:23:29.486747+00
465	72	148	comments	דחוף מאוד	מאושר לאיציה	1	2026-06-23 14:23:32.056418+00
466	73	152	name	\N	Еще один хороший проект	1	2026-06-30 14:23:01.06241+00
467	73	152	client	\N	43	1	2026-06-30 14:23:01.06241+00
468	74	146	painter	צביע באפוקול	צבוע אצל יצרן	1	2026-06-30 15:27:05.032133+00
469	72	151	driver	\N	\n(צבוע אצל יצרן)	1	2026-06-30 15:27:05.094614+00
470	72	148	driver	\N	\n(צבוע אצל יצרן)	1	2026-06-30 15:27:05.111642+00
471	72	150	driver	\N	\n(צבוע אצל יצרן)	1	2026-06-30 15:27:05.129141+00
472	74	146	painter	צבוע אצל יצרן	צביע באפוקול	1	2026-06-30 15:27:11.498378+00
473	72	151	driver	\n(צבוע אצל יצרן)	\n(צביע באפוקול)	1	2026-06-30 15:27:11.548888+00
474	72	148	driver	\n(צבוע אצל יצרן)	\n(צביע באפוקול)	1	2026-06-30 15:27:11.626665+00
475	72	150	driver	\n(צבוע אצל יצרן)	\n(צביע באפוקול)	1	2026-06-30 15:27:11.645972+00
476	74	146	painter	צביע באפוקול	צבוע אצל יצרן	1	2026-06-30 15:28:24.401239+00
477	72	151	driver	\n(צביע באפוקול)	Новый Проект\n(צבוע אצל יצרן)	1	2026-06-30 15:28:24.439214+00
478	72	148	driver	\n(צביע באפוקול)	Новый Проект\n(צבוע אצל יצרן)	1	2026-06-30 15:28:24.45224+00
479	72	150	driver	\n(צביע באפוקול)	Новый Проект\n(צבוע אצל יצרן)	1	2026-06-30 15:28:24.464983+00
480	74	146	painter	צבוע אצל יצרן	צביע באפוקול	1	2026-06-30 15:28:26.05227+00
481	72	151	driver	Новый Проект\n(צבוע אצל יצרן)	Новый Проект\n(צביע באפוקול)	1	2026-06-30 15:28:26.085723+00
482	72	148	driver	Новый Проект\n(צבוע אצל יצרן)	Новый Проект\n(צביע באפוקול)	1	2026-06-30 15:28:26.108464+00
483	72	150	driver	Новый Проект\n(צבוע אצל יצרן)	Новый Проект\n(צביע באפוקול)	1	2026-06-30 15:28:26.121618+00
484	75	153	direction	\N	Производство-Покрасочная	1	2026-06-30 20:22:27.564132+00
485	75	153	pokrasichk	\N	Эпоколь	1	2026-06-30 20:22:27.564132+00
486	75	153	__deleted__	{"direction":"Производство-Покрасочная","pokrasichk":"Эпоколь"}	\N	1	2026-06-30 20:22:32.303016+00
487	75	154	direction	\N	Производство-Покрасочная	1	2026-06-30 20:35:55.848509+00
488	75	154	pokrasichk	\N	Эпоколь	1	2026-06-30 20:35:55.848509+00
489	75	154	date	\N	2026-06-30	1	2026-06-30 20:35:55.848509+00
490	75	154	delivery_cost	\N	300	1	2026-06-30 20:35:55.848509+00
491	75	154	__status__	\N	58	1	2026-06-30 20:36:36.009711+00
492	75	154	direction	Производство-Покрасочная	Покрасочная-Объект	1	2026-06-30 20:57:12.17589+00
493	75	154	direction	Покрасочная-Объект	Производство-Объект	1	2026-06-30 20:57:14.119392+00
494	75	154	direction	Производство-Объект	Производство-Покрасочная	1	2026-06-30 20:57:16.132243+00
495	75	154	__deleted__	{"date":"2026-06-30","direction":"Производство-Покрасочная","pokrasichk":"Эпоколь","delivery_cost":300}	\N	1	2026-07-01 09:01:10.223855+00
496	75	155	direction	\N	Производство-Покрасочная	1	2026-07-01 09:01:29.392593+00
497	75	155	pokrasichk	\N	Эпоколь	1	2026-07-01 09:01:29.392593+00
498	75	155	date	\N	2026-07-01	1	2026-07-01 09:01:29.392593+00
499	75	155	delivery_cost	\N	200	1	2026-07-01 09:01:29.392593+00
500	75	155	__status__	\N	58	1	2026-07-01 09:01:29.392593+00
501	75	155	driver	\N	יסר	1	2026-07-01 13:03:42.090146+00
502	75	155	driver	יסר	אחר	1	2026-07-01 13:03:44.205593+00
503	75	155	driver	אחר	חסן אדנן	1	2026-07-01 13:03:50.884057+00
504	75	155	driver	חסן אדנן	יסר	1	2026-07-01 13:04:00.699087+00
505	75	155	__status__	58	59	1	2026-07-01 13:05:46.238235+00
506	75	155	__status__	59	60	1	2026-07-01 13:05:48.383151+00
507	75	155	__status__	60	58	1	2026-07-01 13:05:50.546859+00
508	75	155	__status__	58	59	1	2026-07-01 13:10:05.210932+00
509	75	155	__status__	59	60	1	2026-07-01 13:10:10.721598+00
510	75	155	__status__	60	58	1	2026-07-01 13:10:22.594148+00
511	75	155	__status__	58	\N	1	2026-07-01 13:10:23.999081+00
512	75	155	__status__	\N	58	1	2026-07-01 13:10:25.994706+00
513	76	156	installation_team	\N	Леша+Купра	1	2026-07-01 15:28:08.828662+00
514	76	156	payment_type	\N	Емит 2000	1	2026-07-01 15:28:08.828662+00
515	76	156	installation_cost	\N	2000	1	2026-07-01 15:28:08.828662+00
516	76	156	installation_date	\N	2026-07-03	1	2026-07-01 15:28:08.828662+00
517	76	156	__status__	\N	61	1	2026-07-01 15:28:08.828662+00
518	72	151	installation_team	\N	Леша+Купра	1	2026-07-02 18:48:10.012607+00
519	72	151	installation_team	Леша+Купра	Миша+Володя	1	2026-07-02 18:55:55.459268+00
520	72	148	installation_team	\N	Миша+Володя	1	2026-07-02 18:55:55.668267+00
521	72	150	installation_team	\N	Миша+Володя	1	2026-07-02 18:55:55.685244+00
522	72	151	installation_team	Миша+Володя	Леша+Купра	1	2026-07-02 18:55:58.090803+00
523	72	148	installation_team	Миша+Володя	Леша+Купра	1	2026-07-02 18:55:58.134019+00
524	72	150	installation_team	Миша+Володя	Леша+Купра	1	2026-07-02 18:55:58.152374+00
525	72	151	installation_team	Леша+Купра	Миша+Володя	1	2026-07-02 18:56:01.633604+00
526	72	148	installation_team	Леша+Купра	Миша+Володя	1	2026-07-02 18:56:01.670255+00
527	72	150	installation_team	Леша+Купра	Миша+Володя	1	2026-07-02 18:56:01.685068+00
528	72	151	installation_team	Миша+Володя	Каблан мишнэ	1	2026-07-02 18:56:03.817938+00
529	72	148	installation_team	Миша+Володя	Каблан мишнэ	1	2026-07-02 18:56:03.865424+00
530	72	150	installation_team	Миша+Володя	Каблан мишнэ	1	2026-07-02 18:56:03.880819+00
531	72	151	installation_team	Каблан мишнэ	Леша+Купра	1	2026-07-02 18:56:06.36505+00
532	72	150	installation_team	Каблан мишнэ	Леша+Купра	1	2026-07-02 18:56:06.398482+00
533	72	148	installation_team	Каблан мишнэ	Леша+Купра	1	2026-07-02 18:56:06.42478+00
534	72	151	installation_team	Леша+Купра	Александр+Ваня	1	2026-07-02 18:56:16.488267+00
535	72	148	installation_team	Леша+Купра	Александр+Ваня	1	2026-07-02 18:56:16.53643+00
536	72	150	installation_team	Леша+Купра	Александр+Ваня	1	2026-07-02 18:56:16.557373+00
538	72	148	__status__	51	50	1	2026-07-02 19:38:55.115511+00
539	74	157	order_number	\N	3555	1	2026-07-05 19:55:57.38271+00
540	74	157	order_file	\N	{"kind":"link","url":"https://docs.google.com/document/d/1LfNqW22SzPe2O_NVM-aUFK4pFx2iy0UTivjn1ugzpIU"}	1	2026-07-05 19:55:57.38271+00
541	74	157	drawing	\N	{"kind":"link","url":"https://drive.google.com/file/d/1-kHEVkQnZCExi4DWzIkyygRmNkYyXwB9"}	1	2026-07-05 19:55:57.38271+00
542	74	157	designer	\N	36	1	2026-07-05 19:55:57.38271+00
543	74	157	production_date	\N	2026-07-05	1	2026-07-05 19:55:57.38271+00
544	74	157	manufacturer	\N	25	1	2026-07-05 19:55:57.38271+00
545	74	157	production_order	\N	{"kind":"link","url":"https://docs.google.com/document/d/14qobPcZsi4b6dmad0xp9iFoD-dSIPIdvtpnT0gGugSI"}	1	2026-07-05 19:55:57.38271+00
546	74	157	painter	\N	ללא צבע	1	2026-07-05 19:55:57.38271+00
547	72	158	project_manager	\N	2	1	2026-07-05 19:56:08.052753+00
548	72	158	client	\N	43	1	2026-07-05 19:56:08.052753+00
549	72	158	item_name	\N	рвыплыыл7687	1	2026-07-05 19:56:08.052753+00
550	72	158	__status__	\N	50	1	2026-07-05 19:56:08.052753+00
551	72	158	quantity	\N	11.88	1	2026-07-05 19:56:49.254519+00
552	72	158	unit_price	\N	475	1	2026-07-05 19:57:03.537507+00
553	72	158	mnf_cost_unit	\N	200	1	2026-07-05 19:57:23.904207+00
554	72	158	production_status	\N	יצאיה לישראל	1	2026-07-05 19:57:53.229905+00
555	72	158	comments	\N	מאושר לאיציה	1	2026-07-05 19:57:55.710159+00
556	72	158	production_finish_date	\N	2026-07-05	1	2026-07-05 19:58:03.249389+00
557	72	158	material_release_date	\N	2026-07-05	1	2026-07-05 19:58:14.110865+00
558	72	158	paint_status	\N	בצבע	1	2026-07-05 19:58:17.206907+00
559	72	158	paint_finish_date	\N	2026-07-05	1	2026-07-05 19:58:24.554469+00
560	76	156	payment_type	Емит 2000	Кабланут	1	2026-07-06 06:39:47.284579+00
561	76	156	payment_type	Кабланут	Емит 2000	1	2026-07-06 06:39:57.312308+00
562	76	156	payment_type	Емит 2000	Кабланут	1	2026-07-06 06:40:15.999219+00
563	76	156	payment_type	Кабланут	Емит 2000	1	2026-07-06 06:43:58.587928+00
564	76	156	payment_type	Емит 2000	Емит 1000	1	2026-07-06 06:44:01.042126+00
565	76	156	payment_type	Емит 1000	По часам	1	2026-07-06 06:44:06.921475+00
566	76	156	payment_type	По часам	Договор	1	2026-07-06 06:44:09.619984+00
567	76	156	payment_type	Договор	Кабланут	1	2026-07-06 06:44:11.686178+00
568	76	156	payment_type	Кабланут	Емит 2000	1	2026-07-06 06:44:49.107469+00
569	76	156	payment_type	Емит 2000	Кабланут	1	2026-07-06 06:44:58.669204+00
570	73	159	name	\N	Ахалуц 54, Тель Авив	1	2026-07-06 19:38:06.788036+00
571	73	159	client	\N	45	1	2026-07-06 19:38:06.788036+00
572	74	160	order_number	\N	3777	1	2026-07-06 19:40:08.647927+00
573	74	160	order_file	\N	{"kind":"link","url":"https://docs.google.com/document/d/1LfNqW22SzPe2O_NVM-aUFK4pFx2iy0UTivjn1ugzpIU"}	1	2026-07-06 19:40:08.647927+00
574	74	160	ral_color	\N	645	1	2026-07-06 19:40:08.647927+00
575	74	160	drawing	\N	{"kind":"link","url":"https://docs.google.com/document/d/1LfNqW22SzPe2O_NVM-aUFK4pFx2iy0UTivjn1ugzpIU"}	1	2026-07-06 19:40:08.647927+00
576	74	160	designer	\N	36	1	2026-07-06 19:40:08.647927+00
577	74	160	production_date	\N	2026-07-06	1	2026-07-06 19:40:08.647927+00
578	74	160	manufacturer	\N	14	1	2026-07-06 19:40:08.647927+00
579	74	160	production_order	\N	{"kind":"link","url":"https://docs.google.com/document/d/1LfNqW22SzPe2O_NVM-aUFK4pFx2iy0UTivjn1ugzpIU"}	1	2026-07-06 19:40:08.647927+00
580	74	160	painter	\N	צביע באפוקול	1	2026-07-06 19:40:08.647927+00
581	74	160	painting_order	\N	{"kind":"link","url":"https://docs.google.com/document/d/1LfNqW22SzPe2O_NVM-aUFK4pFx2iy0UTivjn1ugzpIU"}	1	2026-07-06 19:40:08.647927+00
582	72	161	project_manager	\N	2	1	2026-07-06 19:46:04.418281+00
583	72	161	client	\N	45	1	2026-07-06 19:46:04.418281+00
584	72	161	item_name	\N	Перила балкон 1 левый	1	2026-07-06 19:46:04.418281+00
585	72	161	quantity	\N	11.8	1	2026-07-06 19:46:04.418281+00
586	72	161	unit_price	\N	180	1	2026-07-06 19:46:04.418281+00
587	72	161	mnf_cost_unit	\N	80	1	2026-07-06 19:46:04.418281+00
588	72	161	__status__	\N	50	1	2026-07-06 19:46:04.418281+00
589	72	161	production_status	\N	עוד לא בעבודה	1	2026-07-06 19:53:31.467114+00
590	72	161	production_status	עוד לא בעבודה	ביצור	1	2026-07-06 19:55:23.09697+00
591	72	161	production_status	ביצור	עוד לא בעבודה	14	2026-07-06 20:00:10.571344+00
592	72	161	production_status	עוד לא בעבודה	ביצור	14	2026-07-06 20:00:13.661303+00
593	72	161	production_finish_date	\N	2026-07-11	14	2026-07-06 20:06:39.21564+00
594	72	161	comments	\N	חובה וידיו	1	2026-07-06 20:08:04.735293+00
595	72	161	production_status	ביצור	מוכן לאיציה לישראל	1	2026-07-06 20:08:23.550889+00
596	72	161	production_status	מוכן לאיציה לישראל	יצאיה לישראל	1	2026-07-06 20:10:20.44217+00
597	72	161	production_status	יצאיה לישראל	מוכן לאיציה לישראל	1	2026-07-06 20:10:25.683996+00
598	72	161	comments	חובה וידיו	מאושר לאיציה	1	2026-07-06 20:12:33.881833+00
599	75	162	driver	\N	אדם	1	2026-07-06 20:15:05.787378+00
600	75	162	direction	\N	Производство-Объект	1	2026-07-06 20:15:05.787378+00
601	75	162	date	\N	2026-07-07	1	2026-07-06 20:15:05.787378+00
602	75	162	delivery_cost	\N	200	1	2026-07-06 20:15:05.787378+00
603	75	162	__status__	\N	59	1	2026-07-06 20:15:05.787378+00
604	75	163	driver	\N	סעיד	1	2026-07-06 20:17:18.89065+00
605	75	163	direction	\N	Производство-Объект	1	2026-07-06 20:17:18.89065+00
606	75	163	date	\N	2026-07-07	1	2026-07-06 20:17:18.89065+00
607	75	163	delivery_cost	\N	200	1	2026-07-06 20:17:18.89065+00
608	75	163	__status__	\N	59	1	2026-07-06 20:17:18.89065+00
609	75	163	__status__	59	60	1	2026-07-06 20:21:59.691852+00
610	75	162	__status__	59	60	1	2026-07-06 20:22:01.368797+00
\.


--
-- Data for Name: column_groups; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.column_groups (id, name_json, color, display_mode, text_color, sort_order, created_at, updated_at) FROM stdin;
2	{"ru": "Производство"}	#6366f1	bar	\N	0	2026-06-22 06:38:25.578763+00	2026-06-22 06:38:25.578763+00
3	{"ru": "Покраска"}	#23b11b	bar	\N	0	2026-06-22 06:39:59.71832+00	2026-06-22 06:39:59.71832+00
4	{"ru": "Логистика"}	#a2bc00	bar	\N	0	2026-06-22 06:52:17.800188+00	2026-06-22 06:52:17.800188+00
1	{"ru": "Офис- Менеджер"}	#e6ec9b	bar	\N	0	2026-06-22 06:36:33.14159+00	2026-06-22 11:08:53.611+00
5	{"ru": "Монтаж"}	#0004ff	bar	\N	0	2026-07-02 18:21:27.478805+00	2026-07-02 18:21:27.478805+00
\.


--
-- Data for Name: custom_filters; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.custom_filters (id, entity_id, name_json, is_active, conjunction, groups_json, inputs_json, sort_order, created_at, updated_at) FROM stdin;
1	72	{"ru": "Начало и окончание работ"}	t	or	[{"conditions": [{"pageId": 81, "inputId": "in_dborpa", "fieldKey": "data_nachala_rabot", "operator": "between", "fieldSource": "page", "valueSource": "input"}], "conjunction": "and"}, {"conditions": [{"pageId": 81, "inputId": "in_dborpa", "fieldKey": "data_okonchaniya_rabot", "operator": "between", "fieldSource": "page", "valueSource": "input"}], "conjunction": "and"}]	[{"id": "in_dborpa", "type": "dateRange", "labelJson": {"ru": "Период"}}]	0	2026-07-07 10:07:46.923684+00	2026-07-07 10:13:15.223+00
\.


--
-- Data for Name: dashboard_widgets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.dashboard_widgets (id, page_id, title_json, config_json, visible_role_ids_json, icon, color, sort_order, created_at, updated_at, grid_w, grid_h) FROM stdin;
\.


--
-- Data for Name: deleted_files; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.deleted_files (id, entity_id, entity_name_json, record_id, field_key, field_name_json, file_name, file_path, file_size, content_type, reason, deleted_by, deleted_at) FROM stdin;
\.


--
-- Data for Name: entities; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.entities (id, entity_key, name_json, description_json, icon, page_id, sort_order, is_active, created_at, updated_at, default_sort_json, pivot_enabled, default_filter_json, default_pivot_json, allow_no_status) FROM stdin;
73	projects	{"en": "Projects", "he": "פרויקטים", "ru": "Проекты"}	{}	folder-kanban	\N	2	t	2026-06-11 19:37:18.365588+00	2026-06-18 16:36:22.479+00	[{"field": "__created_at__", "direction": "desc"}]	t	[]	\N	t
74	orders	{"en": "Orders", "he": "הזמנות", "ru": "Заказы"}	{}	file-text	\N	3	t	2026-06-11 19:37:24.050168+00	2026-06-18 16:36:32.2+00	[{"field": "__created_at__", "direction": "desc"}]	t	[]	\N	t
75	delivery	{"en": "Delivery", "he": "משלוח", "ru": "Доставка"}	{}	table	79	4	t	2026-06-30 16:14:06.077331+00	2026-07-01 13:20:00.379+00	[]	f	[]	\N	f
72	items	{"en": "Items", "he": "פריטים", "ru": "Изделия"}	{}	package	64	1	t	2026-06-08 21:01:23.18805+00	2026-07-01 14:14:28.35+00	[{"field": "__created_at__", "direction": "desc"}]	t	[]	\N	t
\.


--
-- Data for Name: entity_automation_runs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.entity_automation_runs (id, automation_id, entity_id, record_id, status, trigger_name, detail_json, dedupe_key, created_at) FROM stdin;
6	5	72	151	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:55:55.704985+00
7	5	72	148	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:55:55.758207+00
8	5	72	150	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:55:55.774653+00
9	5	72	151	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:55:58.174394+00
10	5	72	148	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:55:58.222915+00
11	5	72	150	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:55:58.240637+00
12	5	72	151	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:56:01.708072+00
13	5	72	148	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:56:01.75928+00
14	5	72	150	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:56:01.766855+00
15	5	72	151	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:56:03.886347+00
16	5	72	148	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:56:03.950736+00
17	5	72	150	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:56:04.016573+00
18	5	72	151	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:56:06.43075+00
19	5	72	150	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:56:06.475516+00
20	5	72	148	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:56:06.491242+00
21	5	72	151	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:56:16.586754+00
22	5	72	148	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:56:16.670131+00
23	5	72	150	success	record.updated	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-02 18:56:16.705266+00
31	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 06:39:44.116633+00
32	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 06:39:47.295315+00
33	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 06:39:57.319038+00
34	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 06:40:16.005379+00
35	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 06:43:58.597556+00
36	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 06:44:01.048471+00
37	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 06:44:06.92884+00
38	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 06:44:09.625405+00
39	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 06:44:11.694403+00
40	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 06:44:49.115146+00
41	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 06:44:58.675727+00
42	7	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:08:08.793892+00
43	7	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:08:10.875037+00
44	7	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:08:19.520336+00
45	7	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:08:21.69041+00
46	7	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:10:59.268432+00
47	7	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:11:00.763258+00
48	7	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:11:55.283491+00
49	7	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:11:57.191194+00
50	7	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:11:59.889137+00
51	7	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:12:01.684154+00
52	7	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:14:53.542179+00
53	7	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:14:55.904342+00
54	7	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:14:57.88844+00
55	5	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:17:15.824394+00
56	5	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:17:21.03747+00
57	5	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:19:51.898653+00
58	5	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:19:54.44878+00
59	7	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:19:57.183236+00
60	7	72	151	error	page_field.saved	{"actions": [{"ok": false, "type": "update_records_where"}]}	\N	2026-07-06 07:19:59.217195+00
61	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:25.454116+00
62	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:25.528835+00
63	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:25.556161+00
64	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:27.742407+00
65	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:27.785896+00
66	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:27.7954+00
67	5	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:30.570464+00
68	5	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:30.612883+00
69	5	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:30.720961+00
70	5	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:33.502672+00
71	5	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:33.567601+00
72	5	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:33.576249+00
73	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:37.549004+00
74	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:37.615183+00
75	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:37.637698+00
76	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:41.028604+00
77	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:41.072424+00
78	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 07:23:41.085455+00
79	7	72	158	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 08:04:46.994033+00
80	5	72	158	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 08:10:11.404989+00
81	5	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 08:11:20.889704+00
82	5	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 08:11:20.932594+00
83	5	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 08:11:20.947461+00
84	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 09:58:11.774511+00
85	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 09:58:11.839113+00
86	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 09:58:11.842056+00
87	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 09:58:22.062755+00
88	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 09:58:22.116484+00
89	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 09:58:22.125521+00
90	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:32.451028+00
91	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:32.515411+00
92	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:32.517774+00
93	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:36.491143+00
94	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:36.54613+00
95	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:36.555212+00
96	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:44.978735+00
97	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:45.03193+00
98	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:45.038934+00
99	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:46.865569+00
100	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:46.908148+00
101	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:46.91969+00
102	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:51.089555+00
103	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:51.141726+00
106	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:55.690137+00
104	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:51.143942+00
105	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:55.644768+00
107	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:04:55.705318+00
108	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:06:50.632857+00
109	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:06:50.694689+00
110	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:06:50.697361+00
111	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:06:54.405612+00
112	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:06:54.444827+00
113	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:06:54.453629+00
114	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:07:00.832945+00
115	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:07:00.88147+00
116	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:07:00.896401+00
117	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:07:03.951871+00
118	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:07:03.999758+00
119	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:07:04.00916+00
120	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:26:48.483932+00
121	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:26:48.573104+00
122	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:26:48.57594+00
123	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:26:51.228929+00
124	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:26:51.271813+00
125	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 10:26:51.289824+00
126	5	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 19:27:31.614396+00
127	5	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 19:27:31.676031+00
128	5	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 19:27:31.688081+00
129	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 19:27:38.732408+00
130	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 19:27:38.768764+00
131	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 19:27:38.781066+00
132	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 19:28:33.895805+00
133	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 19:28:33.958807+00
134	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 19:28:33.976761+00
135	5	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 19:29:52.905697+00
136	5	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 19:29:52.968081+00
137	5	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 19:29:52.976764+00
138	7	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 19:31:48.779474+00
139	7	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 19:31:48.845662+00
140	7	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-06 19:31:48.85302+00
141	8	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-07 07:03:51.854172+00
142	8	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-07 07:03:51.957187+00
143	8	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-07 07:03:51.963972+00
144	9	72	151	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-07 07:03:58.671707+00
145	9	72	148	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-07 07:03:58.731584+00
146	9	72	150	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-07 07:03:58.744152+00
147	8	72	158	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-07 07:04:11.290396+00
148	9	72	158	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-07 07:04:14.796249+00
149	8	72	158	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-07 07:04:47.43291+00
150	9	72	158	success	page_field.saved	{"actions": [{"ok": true, "type": "update_records_where"}]}	\N	2026-07-07 07:04:56.323085+00
\.


--
-- Data for Name: entity_automations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.entity_automations (id, entity_id, name_json, is_active, trigger_json, conditions_json, actions_json, sort_order, created_at, updated_at, condition_conjunction) FROM stdin;
9	72	{"ru": "Монтаж - окончание работ"}	t	{"type": "page_field_changed", "pageId": 81, "fieldKey": "data_okonchaniya_rabot"}	[]	[{"type": "update_records_where", "match": [{"fieldKey": "order_number", "operator": "eq", "valueSource": "field", "valueFieldKey": "order_number"}], "mapping": [{"sourceType": "field", "sourcePageId": 81, "targetPageId": 81, "sourceFieldKey": "data_okonchaniya_rabot", "targetFieldKey": "data_okonchaniya_rabot", "sourceFieldSource": "page", "targetFieldSource": "page"}], "targetEntityId": 72}]	4	2026-07-07 07:03:19.338071+00	2026-07-07 07:03:19.338071+00	and
7	72	{"ru": "Монтаж - Тип оплаты"}	t	{"type": "page_field_changed", "pageId": 81, "fieldKey": "tip_oplaty"}	[]	[{"type": "update_records_where", "match": [{"fieldKey": "order_number", "operator": "eq", "valueSource": "field", "valueFieldKey": "order_number"}], "mapping": [{"sourceType": "field", "sourcePageId": 81, "targetPageId": 81, "sourceFieldKey": "tip_oplaty", "targetFieldKey": "tip_oplaty", "sourceFieldSource": "page", "targetFieldSource": "page"}], "targetEntityId": 72}]	2	2026-07-06 06:39:32.826802+00	2026-07-06 07:11:48.73+00	and
5	72	{"ru": "Монтажные бригады"}	t	{"type": "page_field_changed", "pageId": 81, "fieldKey": "installation_team"}	[]	[{"type": "update_records_where", "match": [{"fieldKey": "order_number", "operator": "eq", "valueSource": "field", "valueFieldKey": "order_number"}], "mapping": [{"sourceType": "field", "sourcePageId": 81, "targetPageId": 81, "sourceFieldKey": "installation_team", "targetFieldKey": "installation_team", "sourceFieldSource": "page", "targetFieldSource": "page"}], "targetEntityId": 72}]	1	2026-07-02 18:55:46.84854+00	2026-07-06 07:15:35.891684+00	and
8	72	{"ru": "Монтаж - дата начала работ"}	t	{"type": "page_field_changed", "pageId": 81, "fieldKey": "data_nachala_rabot"}	[]	[{"type": "update_records_where", "match": [{"fieldKey": "order_number", "operator": "eq", "valueSource": "field", "valueFieldKey": "order_number"}], "mapping": [{"sourceType": "field", "sourcePageId": 81, "targetPageId": 81, "sourceFieldKey": "data_nachala_rabot", "targetFieldKey": "data_nachala_rabot", "sourceFieldSource": "page", "targetFieldSource": "page"}], "targetEntityId": 72}]	3	2026-07-07 07:02:24.863119+00	2026-07-07 07:02:24.863119+00	and
\.


--
-- Data for Name: entity_fields; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.entity_fields (id, entity_id, field_key, name_json, description_json, field_type, is_required, default_value, options_json, sort_order, is_active, created_at, updated_at, permissions_json, is_filterable, show_in_table, file_config_json, user_config_json, format_rules_json, formula_config_json, show_column_total, total_fill_color, total_text_color, dependency_config_json, is_pinned, is_key, lock_after_create, relation_config_json, pivot_enabled, column_group_id, validation_rules_json, wrap_text, default_to_today, percent_config_json) FROM stdin;
189	74	manufacturer	{"en": "Manufacturer", "he": "יצרן", "ru": "Производитель"}	{}	user	t	\N	[]	8	t	2026-06-13 17:08:05.443001+00	2026-06-18 16:36:50.7+00	{"4": "view"}	f	t	{}	{"allowedRoleIds": [4]}	[]	{}	f	\N	\N	{}	f	f	f	{}	t	\N	[]	f	f	{}
201	72	makasa	{"ru": "Makasa"}	{}	file	f	\N	[]	24	t	2026-06-22 13:52:42.33929+00	2026-06-22 13:52:50.624+00	{}	f	t	{"driveFolderId": "13jIMt-GPWfSCNOUsxMVYS2QK2Iqb4TYW", "allowedSources": ["gdrive", "link"]}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	f	2	[]	f	f	{}
159	72	materials_cost	{"en": "DWG Drawings", "he": " תוכניות DWG", "ru": "DWG Чертежи"}	{}	lookup	f	\N	[]	12	t	2026-06-08 21:01:23.18805+00	2026-06-22 21:04:45.605+00	{"4": "view"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{"relationId": 25, "writeThrough": true, "relatedFieldKey": "dwg_drawings"}	t	1	[]	f	f	{}
160	72	designer	{"en": "Designer", "he": "מעצב", "ru": "Проектировщик"}	{}	lookup	f	\N	[]	13	t	2026-06-08 21:01:23.18805+00	2026-06-22 21:05:08.625+00	{"4": "hidden"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{"relationId": 25, "writeThrough": true, "relatedFieldKey": "designer"}	t	1	[]	f	f	{}
190	74	production_order	{"en": "Production order", "he": "הזמנת ייצור", "ru": "Заказ на производство"}	{}	file	t	\N	[]	9	t	2026-06-13 17:08:05.456461+00	2026-06-15 08:02:52.885+00	{"4": "view"}	f	t	{"allowedSources": ["gdrive", "link"]}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	f	\N	[]	f	f	{}
167	72	production_status	{"en": "Production Status", "he": "סטטוס ייצור", "ru": "Статус производства"}	{}	select	f	\N	[{"value": "בצביעה", "labelJson": {"ru": "בצביעה"}}, {"value": "מוכן לבדיקה", "labelJson": {"ru": "מוכן לבדיקה"}}, {"value": "מוכן לאיציה לישראל", "labelJson": {"ru": "מוכן לאיציה לישראל"}}, {"value": "מוכפא", "labelJson": {"ru": "מוכפא"}}, {"value": "יצאיה לישראל", "labelJson": {"ru": "יצאיה לישראל"}}, {"value": "ביצור", "labelJson": {"ru": "ביצור"}}, {"value": "עוד לא בעבודה", "labelJson": {"ru": "עוד לא בעבודה"}}]	21	t	2026-06-08 21:01:23.18805+00	2026-07-06 19:55:08.818+00	{}	t	t	{}	{}	[{"value": "בצביעה", "operator": "equals", "rowColor": "", "cellColor": "#FFE5A0"}, {"value": "מוכן לבדיקה", "operator": "equals", "rowColor": "", "cellColor": "#B10202", "textColor": "#ffffff"}, {"value": "מוכן לאיציה לישראל", "operator": "equals", "rowColor": "", "cellColor": "#D4EDBC"}, {"value": "מוכפא", "operator": "equals", "rowColor": "", "cellColor": "#0A53A8", "textColor": "#ffffff"}, {"value": "יצאיה לישראל", "operator": "equals", "rowColor": "", "cellColor": "#11734B", "textColor": "#ffffff"}, {"value": "עוד לא בעבודה", "operator": "equals", "rowColor": "", "cellColor": "#FFCFC9"}, {"value": "ביצור", "operator": "equals", "rowColor": "", "cellColor": "#eee670"}]	{}	f	\N	\N	{}	f	f	f	{}	t	2	[]	f	f	{}
192	74	painting_order	{"en": "Painting order", "he": "הזמנת צביעה", "ru": "Заказ на покраску"}	{}	file	f	\N	[]	11	t	2026-06-13 17:08:05.477249+00	2026-06-15 08:03:30.997+00	{"4": "hidden"}	f	t	{"allowedSources": ["gdrive", "link"]}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	f	\N	[]	f	f	{}
161	72	designer_cost	{"en": "Cost SD", "he": "עלות SD", "ru": "Оплата SD"}	{}	number	f	\N	[]	14	t	2026-06-08 21:01:23.18805+00	2026-06-22 21:05:16.228+00	{"4": "hidden"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	t	1	[]	f	f	{}
194	72	order_file	{"en": "Order file", "he": "קובץ הזמנה", "ru": "Файл заказа"}	{}	lookup	f	\N	[]	6	t	2026-06-14 05:55:34.710496+00	2026-06-22 21:03:45.506+00	{"4": "hidden"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{"relationId": 25, "writeThrough": true, "relatedFieldKey": "order_file"}	t	1	[]	f	f	{}
162	72	entry_date	{"en": "Entry Date", "he": "תאריך כניסה", "ru": "Дата на производство"}	{}	lookup	f	\N	[]	15	t	2026-06-08 21:01:23.18805+00	2026-06-22 21:05:26.335+00	{"4": "view"}	t	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{"relationId": 25, "writeThrough": true, "relatedFieldKey": "production_date"}	t	2	[]	f	f	{}
197	72	ral_color	{"en": "RAL Color", "he": "צבע RAL", "ru": "Цвет RAL"}	{}	lookup	f	\N	[]	8	t	2026-06-14 08:16:05.784124+00	2026-06-22 21:04:03.784+00	{"4": "view"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{"relationId": 25, "writeThrough": true, "relatedFieldKey": "ral_color"}	t	1	[]	f	f	{}
158	72	units_total_price	{"en": "Total", "he": "סה״כ", "ru": "Сумма"}	{}	function	f	\N	[]	11	t	2026-06-08 21:01:23.18805+00	2026-06-22 13:52:48.63+00	{"4": "hidden"}	f	t	{}	{}	[]	{"decimals": 2, "expression": "{quantity}*{unit_price}"}	t	#f7f7b9	#000000	{}	f	f	f	{}	f	1	[]	f	f	{}
179	72	client	{"en": "Client", "he": "לקוח", "ru": "Клиент"}	{}	user	t	\N	[]	2	t	2026-06-10 11:30:06.409815+00	2026-06-26 07:35:45.003+00	{"4": "hidden"}	t	t	{}	{"allowCreate": true, "allowedRoleIds": [11]}	[]	{}	f	\N	\N	{}	f	f	f	{}	t	1	[]	f	f	{}
191	74	painter	{"en": "Painter", "he": "צבעי", "ru": "Покрасчик"}	{}	select	t	\N	[{"value": "צבוע אצל יצרן", "labelJson": {"ru": "צבוע אצל יצרן"}}, {"value": "צביע באפוקול", "labelJson": {"ru": "צביע באפוקול"}}, {"value": "ללא צבע", "labelJson": {"ru": "ללא צבע"}}]	10	t	2026-06-13 17:08:05.467071+00	2026-06-18 16:36:51.616+00	{"4": "view"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	t	\N	[]	f	f	{}
185	74	drawing	{"en": "Drawing", "he": "שרטוט", "ru": "Чертеж"}	{}	file	t	\N	[]	4	t	2026-06-13 17:08:05.357383+00	2026-06-15 08:01:18.341+00	{"4": "view"}	f	t	{"allowedSources": ["gdrive", "link"]}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	f	\N	[]	f	f	{}
186	74	dwg_drawings	{"en": "DWG Drawings", "he": "שרטוטי DWG", "ru": "DWG Чертежи"}	{}	file	f	\N	[]	5	t	2026-06-13 17:08:05.407041+00	2026-06-15 08:01:38.658+00	{"4": "view"}	f	t	{"allowedSources": ["gdrive", "link"]}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	f	\N	[]	f	f	{}
180	73	name	{"en": "Project Name", "he": "שם הפרויקט", "ru": "Название проекта"}	{}	text	t	\N	[]	1	t	2026-06-11 19:37:42.160071+00	2026-06-18 16:36:25.519+00	{"4": "view"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	t	f	{}	t	\N	[]	f	f	{}
181	73	client	{"en": "Client", "he": "לקוח", "ru": "Клиент"}	{}	user	t	\N	[]	2	t	2026-06-11 19:37:42.160071+00	2026-06-18 16:36:26.397+00	{"4": "hidden"}	f	t	{}	{"allowedRoleIds": [11]}	[]	{}	f	\N	\N	{}	f	f	t	{}	t	\N	[]	f	f	{}
187	74	designer	{"en": "Designer", "he": "מתכנן", "ru": "Проектировщик"}	{}	user	t	\N	[]	6	t	2026-06-13 17:08:05.420017+00	2026-06-18 16:36:48.369+00	{"4": "hidden"}	f	t	{}	{"allowedRoleIds": [13]}	[]	{}	f	\N	\N	{}	f	f	f	{}	t	\N	[]	f	f	{}
188	74	production_date	{"en": "Production date", "he": "תאריך לייצור", "ru": "Дата на производство"}	{}	date	t	\N	[]	7	t	2026-06-13 17:08:05.431245+00	2026-06-18 16:36:49.705+00	{"4": "view"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	t	\N	[]	f	f	{}
207	75	driver	{"en": "Driver", "he": "נהג", "ru": "Водитель"}	{}	select	t	\N	[{"value": "יסר", "labelJson": {"ru": "יסר"}}, {"value": "סעיד", "labelJson": {"ru": "סעיד"}}, {"value": "אדם", "labelJson": {"ru": "אדם"}}, {"value": "סמיון", "labelJson": {"ru": "סמיון"}}, {"value": "חסן", "labelJson": {"ru": "חסן"}}, {"value": "חסן אדנן", "labelJson": {"ru": "חסן אדנן"}}, {"value": "אחר", "labelJson": {"ru": "אחר"}}]	2	t	2026-07-01 13:01:06.855766+00	2026-07-01 13:03:37.868+00	{}	t	t	{}	{}	[{"value": "יסר", "operator": "equals", "rowColor": "", "cellColor": "#E6E6E6"}, {"value": "סעיד", "operator": "equals", "rowColor": "", "cellColor": "#E6E6E6"}, {"value": "אדם", "operator": "equals", "rowColor": "", "cellColor": "#E6E6E6"}, {"value": "סמיון", "operator": "equals", "rowColor": "", "cellColor": "#E6CFF2"}, {"value": "חסן", "operator": "equals", "rowColor": "", "cellColor": "#E6E6E6"}, {"value": "חסן אדנן", "operator": "equals", "rowColor": "", "cellColor": "#E6E6E6"}, {"value": "אחר", "operator": "equals", "rowColor": "", "cellColor": "#B10202", "textColor": "#ffffff"}]	{}	f	\N	\N	{}	f	f	f	{}	f	\N	[]	f	f	{}
152	72	item_name	{"en": "Item", "he": "פריט", "ru": "Изделие"}	{}	text	t	\N	[]	4	t	2026-06-08 21:01:23.18805+00	2026-06-26 07:35:54.538+00	{"4": "view"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	t	1	[]	f	f	{}
151	72	project_name	{"en": "Project", "he": "פרויקט", "ru": "Проект"}	{}	relation	t	\N	[]	3	t	2026-06-08 21:01:23.18805+00	2026-06-26 07:36:06.22+00	{"4": "view"}	t	t	{}	{}	[]	{}	f	\N	\N	{"dependsOnFieldKey": "client", "relatedFilterFieldKey": "client"}	f	f	t	{"relationId": 24, "relatedFieldKey": "name"}	t	1	[]	f	f	{}
182	74	order_number	{"en": "Order Number", "he": "מספר הזמנה", "ru": "Номер заказа"}	{}	text	t	\N	[]	1	t	2026-06-11 19:37:47.704258+00	2026-06-18 16:36:33.493+00	{"4": "view"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	t	t	{}	t	\N	[]	f	f	{}
202	75	order	{"en": "Order", "he": "הזמנה", "ru": "Заказ"}	{}	relation	t	\N	[]	1	t	2026-06-30 16:16:49.333926+00	2026-07-01 13:01:30.534+00	{}	t	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	t	{"relationId": 28, "relatedFieldKey": "order_number"}	f	\N	[]	f	f	{}
150	72	project_manager	{"en": "Project Manager", "he": "מינהל פרוייקט", "ru": "Управляющий проектами"}	{}	user	t	\N	[]	1	t	2026-06-08 21:01:23.18805+00	2026-06-22 21:02:35.399+00	{"4": "view"}	t	t	{}	{"allowCreate": false, "allowedRoleIds": [2]}	[{"value": "2", "operator": "equals", "rowColor": "", "cellColor": "#BFE1F6"}, {"value": "20", "operator": "equals", "rowColor": "", "cellColor": "#E6CFF2"}, {"value": "21", "operator": "equals", "rowColor": "", "cellColor": "#E8EAED"}]	{}	f	\N	\N	{}	f	f	f	{}	t	1	[]	f	f	{}
205	75	date	{"en": "Date", "he": "תאריך הובלה", "ru": "Дата"}	{}	date	t	\N	[]	5	t	2026-06-30 20:25:19.632013+00	2026-07-01 13:01:30.536+00	{}	t	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	f	\N	[]	f	t	{}
153	72	order_number	{"en": "Order Number", "he": "מספר הזמנה", "ru": "Номер заказа"}	{}	relation	t	\N	[]	5	t	2026-06-08 21:01:23.18805+00	2026-06-22 21:03:21.741+00	{"4": "view"}	t	t	{}	{}	[]	{}	f	\N	\N	{"dependsOnFieldKey": "project_name", "relatedFilterFieldKey": "project"}	f	f	t	{"relationId": 25, "relatedFieldKey": "order_number"}	t	1	[]	f	f	{}
156	72	quantity	{"en": "mm/m/pcs", "he": "מ\\"א/מ\\"ר/יח", "ru": "мм/м/ед."}	{}	number	f	\N	[]	9	t	2026-06-08 21:01:23.18805+00	2026-06-22 21:04:20.752+00	{"4": "view"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	t	1	[]	f	f	{}
184	74	project	{"en": "Project", "he": "פרויקט", "ru": "Проект"}	{}	relation	t	\N	[]	2	t	2026-06-11 19:37:47.704258+00	2026-06-15 08:00:58.725+00	{"4": "view"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	t	{"relationId": 23, "relatedFieldKey": "name"}	f	\N	[]	f	f	{}
183	74	order_file	{"en": "Order File", "he": "קובץ הזמנה", "ru": "Файл заказа"}	{}	file	t	\N	[]	3	t	2026-06-11 19:37:47.704258+00	2026-06-15 08:01:08.899+00	{"4": "hidden"}	f	t	{"allowedSources": ["gdrive", "link"]}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	f	\N	[]	f	f	{}
164	72	manufacturer_order_number	{"en": "Manufacturer Order #", "he": "הזמנה יצרן", "ru": "Заказ на производство"}	{}	lookup	f	\N	[]	17	t	2026-06-08 21:01:23.18805+00	2026-06-22 21:05:47.053+00	{"4": "view"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{"relationId": 25, "writeThrough": true, "relatedFieldKey": "production_order"}	t	2	[]	f	f	{}
168	72	production_finish_date	{"en": "Production Finish Date", "he": "תאריך סיום ייצור", "ru": "Дата готовности"}	{}	date	f	\N	[]	22	t	2026-06-08 21:01:23.18805+00	2026-06-22 13:52:48.634+00	{}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	t	2	[]	f	f	{}
165	72	production_cost	{"en": "Production Cost", "he": "עלות ייצור", "ru": "Стоимость производства"}	{}	function	f	\N	[]	19	t	2026-06-08 21:01:23.18805+00	2026-06-22 21:06:03.903+00	{"4": "view"}	f	t	{}	{}	[]	{"decimals": 2, "expression": "{quantity}*{mnf_cost_unit}"}	t	#F7F7B9	#000000	{}	f	f	f	{}	f	2	[]	f	f	{}
206	75	delivery_cost	{"en": "Delivery Cost", "he": "עלות הובלה", "ru": "Стоимость доставки"}	{}	number	t	\N	[]	6	t	2026-06-30 20:28:37.485756+00	2026-07-01 13:01:30.537+00	{}	f	t	{}	{}	[]	{}	t	#F7F7B9	#000000	{}	f	f	f	{}	f	\N	[]	f	f	{}
163	72	manufacturer	{"en": "Manufacturer", "he": "יצרן", "ru": "Производитель"}	{}	lookup	f	\N	[]	16	t	2026-06-08 21:01:23.18805+00	2026-06-22 21:05:35.904+00	{"4": "hidden"}	t	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{"relationId": 25, "writeThrough": true, "relatedFieldKey": "manufacturer"}	t	2	[]	f	f	{}
166	72	painter	{"en": "Painter", "he": "צבעי", "ru": "Покрасчик"}	{}	lookup	f	\N	[]	25	t	2026-06-08 21:01:23.18805+00	2026-06-22 21:06:57.574+00	{"4": "view"}	f	t	{}	{}	[{"value": "צבוע אצל יצרן", "operator": "equals", "rowColor": "", "cellColor": "#D4EDBC"}, {"value": "צביע באפוקול", "operator": "equals", "rowColor": "", "cellColor": "#FFCFC9"}, {"value": "ללא צבע", "operator": "equals", "rowColor": "", "cellColor": "#E8EAED"}]	{}	f	\N	\N	{}	f	f	f	{"relationId": 25, "writeThrough": true, "relatedFieldKey": "painter"}	t	3	[]	f	f	{}
196	74	ral_color	{"en": "RAL Color", "he": "צבע RAL", "ru": "Цвет RAL"}	{}	text	f	\N	[]	4	t	2026-06-14 08:13:54.965324+00	2026-06-18 16:36:36.559+00	{"4": "view"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	t	\N	[]	f	f	{}
176	72	paint_finish_date	{"en": "Entery Date to Paint", "he": "תאריך כניסה", "ru": "Принято на покраску (дата)"}	{}	date	f	\N	[]	27	t	2026-06-08 21:01:23.18805+00	2026-06-26 07:40:32.209+00	{"4": "hidden"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	t	3	[]	f	f	{}
175	72	paint_cost	{"en": "Quality control", "he": "דוחות בקרת איכות", "ru": "Контроле качества"}	{}	file	f	\N	[]	28	t	2026-06-08 21:01:23.18805+00	2026-06-26 07:43:26.927+00	{"4": "hidden"}	f	t	{"driveFolderId": "1jnVxeqEsj1QnhYuIdhIuDplbB2TIz0Rl", "allowedSources": ["gdrive", "link"]}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	t	3	[]	f	f	{}
204	75	pokrasichk	{"en": "Painter", "he": "צבעי", "ru": "Покрасичк"}	{}	select	f	\N	[{"value": "Эпоколь", "labelJson": {"ru": "Эпоколь"}}, {"value": "Джеки", "labelJson": {"ru": "Джеки"}}]	4	t	2026-06-30 19:13:42.45878+00	2026-07-01 13:01:30.536+00	{}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	f	\N	[]	f	f	{}
173	72	epokol_order_number	{"en": "Epokol Order #", "he": "מספר הזמנת אפוקול", "ru": "Номер заказа Эпокол"}	{}	lookup	f	\N	[]	29	t	2026-06-08 21:01:23.18805+00	2026-06-26 07:44:22.772+00	{"4": "hidden"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{"relationId": 25, "writeThrough": true, "relatedFieldKey": "painting_order"}	t	3	[]	f	f	{}
178	72	comments	{"en": "", "he": "", "ru": "Разрешение заказа"}	{}	select	f	\N	[{"value": "מאושר לאיציה", "labelJson": {"ru": "מאושר לאיציה"}}, {"value": "לא מאושר", "labelJson": {"ru": "לא מאושר"}}, {"value": "חובה וידיו", "labelJson": {"ru": "חובה וידיו"}}, {"value": "מוקפא", "labelJson": {"ru": "מוקפא"}}, {"value": "דחוף מאוד", "labelJson": {"ru": "דחוף מאוד"}}]	20	t	2026-06-08 21:01:23.18805+00	2026-07-06 20:12:24.77+00	{"4": "view"}	f	t	{}	{}	[{"value": "מאושר לאיציה", "operator": "equals", "rowColor": "", "cellColor": "#D4EDBC"}, {"value": "לא מאושר", "operator": "equals", "rowColor": "", "cellColor": "#FFCFC9"}, {"value": "חובה וידיו", "operator": "equals", "rowColor": "", "cellColor": "#FFCFC9"}, {"value": "מוקפא", "operator": "equals", "rowColor": "", "cellColor": "#0A53A8", "textColor": "#ffffff"}, {"value": "דחוף מאוד", "operator": "equals", "rowColor": "", "cellColor": "#B10202", "textColor": "#ffffff"}]	{}	f	\N	\N	{}	f	f	f	{}	t	2	[{"value": "מוכן לאיציה לישראל", "operator": "equals", "applyToValues": ["מאושר לאיציה"], "conditionFieldKey": "production_status"}]	f	f	{}
154	72	drawing	{"en": "Drawing", "he": "תוכניות", "ru": "Чертёж"}	{}	lookup	f	\N	[]	7	t	2026-06-08 21:01:23.18805+00	2026-06-22 21:03:53.571+00	{"4": "view"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{"relationId": 25, "writeThrough": true, "relatedFieldKey": "drawing"}	t	1	[]	f	f	{}
157	72	unit_price	{"en": "Price", "he": "עלות", "ru": "Стоимость"}	{}	number	f	\N	[]	10	t	2026-06-08 21:01:23.18805+00	2026-06-22 21:04:28.037+00	{"4": "hidden"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	t	1	[]	f	f	{}
195	72	mnf_cost_unit	{"en": "Production Cost per sq. m./unit.", "he": "עלות ייצור למ\\"א/מ\\"ר/יח", "ru": "Стоимость производства за м. кв./ед."}	{}	number	f	\N	[]	18	t	2026-06-14 06:47:51.81596+00	2026-06-22 21:05:55.863+00	{"4": "view"}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	t	2	[]	f	f	{}
200	72	material_release_date	{"en": "Material Release Date", "he": "תאריך יציאת חומר", "ru": "Дата выпуска материала"}	{}	date	f	\N	[]	23	t	2026-06-22 13:50:54.906299+00	2026-06-26 07:48:32.629+00	{}	f	t	{}	{}	[]	{}	f	\N	\N	{}	f	f	f	{}	t	2	[]	f	f	{}
174	72	paint_status	{"en": "Paint Status", "he": "סטטוס צביעה", "ru": "Статус покраски"}	{}	select	f	\N	[{"value": "בשטח לפני צבע", "labelJson": {"ru": "בשטח לפני צבע"}}, {"value": "בצבע", "labelJson": {"ru": "בצבע"}}, {"value": "מוקפא", "labelJson": {"ru": "מוקפא"}}, {"value": "לצבוע דחוף", "labelJson": {"ru": "לצבוע דחוף"}}, {"value": "מוכנ חלקי/פסולים", "labelJson": {"ru": "מוכנ חלקי/פסולים"}}, {"value": "יצאה לאתר", "labelJson": {"ru": "יצאה לאתר"}}, {"value": "יצאה חלקי", "labelJson": {"ru": "יצאה חלקי"}}, {"value": "מוכן להובלה", "labelJson": {"ru": "מוכן להובלה"}}]	26	t	2026-06-08 21:01:23.18805+00	2026-06-22 21:07:10.221+00	{"4": "hidden"}	t	t	{}	{}	[{"value": "בשטח לפני צבע", "operator": "equals", "rowColor": "", "cellColor": "#FFE5A0"}, {"value": "בצבע", "operator": "equals", "rowColor": "", "cellColor": "#E9DD3D"}, {"value": "מוקפא", "operator": "equals", "rowColor": "", "cellColor": "#0A53A8", "textColor": "#ffffff"}, {"value": "לצבוע דחוף", "operator": "equals", "rowColor": "", "cellColor": "#F10D0D", "textColor": "#ffffff"}, {"value": "מוכנ חלקי/פסולים", "operator": "equals", "rowColor": "", "cellColor": "#E6CFF2"}, {"value": "יצאה לאתר", "operator": "equals", "rowColor": "", "cellColor": "#D4EDBC"}, {"value": "יצאה חלקי", "operator": "equals", "rowColor": "", "cellColor": "#FFCFC9"}, {"value": "מוכן להובלה", "operator": "equals", "rowColor": "", "cellColor": "#FFCFC9"}]	{}	f	\N	\N	{}	f	f	f	{}	t	3	[]	f	f	{}
203	75	direction	{"en": "Direction", "he": "כיוון", "ru": "Направление"}	{}	select	t	\N	[{"value": "Производство-Покрасочная", "labelJson": {"ru": "Производство-Покрасочная"}}, {"value": "Покрасочная-Объект", "labelJson": {"ru": "Покрасочная-Объект"}}, {"value": "Производство-Объект", "labelJson": {"ru": "Производство-Объект"}}]	3	t	2026-06-30 17:20:04.970975+00	2026-07-01 13:01:30.535+00	{}	f	t	{}	{}	[{"value": "Производство-Покрасочная", "operator": "equals", "rowColor": "", "cellColor": "#FFE5A0", "textColor": "#000000"}, {"value": "Производство-Объект", "operator": "equals", "rowColor": "", "cellColor": "#D4EDBC", "textColor": "#000000"}, {"value": "Покрасочная-Объект", "operator": "equals", "rowColor": "", "cellColor": "#cceeff", "textColor": "#000000"}]	{}	f	\N	\N	{}	f	f	t	{}	f	\N	[{"value": "", "operator": "notEmpty", "applyToValues": ["Производство-Покрасочная", "Покрасочная-Объект"], "conditionFieldKey": "pokrasichk"}]	f	f	{}
\.


--
-- Data for Name: entity_records; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.entity_records (id, entity_id, values_json, status_id, created_at, updated_at, archived_at, status_changed_at, archive_exempt) FROM stdin;
161	72	{"client": 45, "comments": "מאושר לאיציה", "quantity": 11.8, "item_name": "Перила балкон 1 левый", "unit_price": 180, "mnf_cost_unit": 80, "project_manager": 2, "production_status": "מוכן לאיציה לישראל", "production_finish_date": "2026-07-11"}	50	2026-07-06 19:46:04.385463+00	2026-07-06 20:12:33.876+00	\N	2026-07-06 19:46:04.385+00	f
155	75	{"date": "2026-07-01", "driver": "יסר", "direction": "Производство-Покрасочная", "pokrasichk": "Эпоколь", "delivery_cost": 200}	58	2026-07-01 09:01:29.385654+00	2026-07-01 13:10:25.989+00	\N	2026-07-01 13:10:25.988+00	f
157	74	{"drawing": {"url": "https://drive.google.com/file/d/1-kHEVkQnZCExi4DWzIkyygRmNkYyXwB9", "kind": "link"}, "painter": "ללא צבע", "designer": 36, "order_file": {"url": "https://docs.google.com/document/d/1LfNqW22SzPe2O_NVM-aUFK4pFx2iy0UTivjn1ugzpIU", "kind": "link"}, "manufacturer": 25, "order_number": "3555", "production_date": "2026-07-05", "production_order": {"url": "https://docs.google.com/document/d/14qobPcZsi4b6dmad0xp9iFoD-dSIPIdvtpnT0gGugSI", "kind": "link"}}	\N	2026-07-05 19:55:57.345054+00	2026-07-05 19:55:57.345054+00	\N	2026-07-05 19:55:57.353+00	f
163	75	{"date": "2026-07-07", "driver": "סעיד", "direction": "Производство-Объект", "delivery_cost": 200}	60	2026-07-06 20:17:18.859387+00	2026-07-06 20:21:59.422+00	\N	2026-07-06 20:21:59.42+00	f
159	73	{"name": "Ахалуц 54, Тель Авив", "client": 45}	\N	2026-07-06 19:38:06.653348+00	2026-07-06 19:38:06.653348+00	\N	2026-07-06 19:38:06.706+00	f
160	74	{"drawing": {"url": "https://docs.google.com/document/d/1LfNqW22SzPe2O_NVM-aUFK4pFx2iy0UTivjn1ugzpIU", "kind": "link"}, "painter": "צביע באפוקול", "designer": 36, "ral_color": "645", "order_file": {"url": "https://docs.google.com/document/d/1LfNqW22SzPe2O_NVM-aUFK4pFx2iy0UTivjn1ugzpIU", "kind": "link"}, "manufacturer": 14, "order_number": "3777", "painting_order": {"url": "https://docs.google.com/document/d/1LfNqW22SzPe2O_NVM-aUFK4pFx2iy0UTivjn1ugzpIU", "kind": "link"}, "production_date": "2026-07-06", "production_order": {"url": "https://docs.google.com/document/d/1LfNqW22SzPe2O_NVM-aUFK4pFx2iy0UTivjn1ugzpIU", "kind": "link"}}	\N	2026-07-06 19:40:08.612086+00	2026-07-06 19:40:08.612086+00	\N	2026-07-06 19:40:08.613+00	f
162	75	{"date": "2026-07-07", "driver": "אדם", "direction": "Производство-Объект", "delivery_cost": 200}	60	2026-07-06 20:15:05.749904+00	2026-07-06 20:22:01.364+00	\N	2026-07-06 20:22:01.363+00	f
158	72	{"client": 43, "comments": "מאושר לאיציה", "quantity": 11.88, "item_name": "рвыплыыл7687", "unit_price": 475, "paint_status": "בצבע", "mnf_cost_unit": 200, "project_manager": 2, "paint_finish_date": "2026-07-05", "production_status": "יצאיה לישראל", "material_release_date": "2026-07-05", "production_finish_date": "2026-07-05"}	50	2026-07-05 19:56:08.040992+00	2026-07-05 19:58:24.55+00	\N	2026-07-05 19:56:08.041+00	f
151	72	{"client": 22, "comments": "מאושר לאיציה", "quantity": 13, "item_name": "рпап", "unit_price": 450, "paint_status": "בצבע", "mnf_cost_unit": 210, "project_manager": 20, "paint_finish_date": "2222-11-11", "production_status": "יצאיה לישראל", "material_release_date": "2026-06-23", "production_finish_date": "2026-06-22"}	50	2026-06-21 20:59:06.899862+00	2026-07-02 19:27:33.158+00	\N	2026-06-21 20:59:06.9+00	f
148	72	{"client": 22, "comments": "מאושר לאיציה", "quantity": 11.7, "item_name": "ааа", "unit_price": 300, "paint_status": "יצאה חלקי", "mnf_cost_unit": 150, "project_manager": 2, "paint_finish_date": "2026-06-26", "production_status": "יצאיה לישראל"}	50	2026-06-14 06:53:16.762894+00	2026-07-02 19:38:54.975+00	\N	2026-07-02 19:38:54.973+00	f
150	72	{"client": 22, "comments": "לא מאושר", "quantity": 11, "item_name": "еарпор", "unit_price": 200, "paint_status": "מוכן להובלה", "mnf_cost_unit": 100, "project_manager": 21, "paint_finish_date": "2026-06-22", "production_status": "מוכן לאיציה לישראל"}	50	2026-06-21 20:06:08.588864+00	2026-07-02 18:56:16.666+00	\N	2026-06-21 20:06:08.589+00	f
140	73	{"name": "Новый Проект", "client": 22}	\N	2026-06-12 19:37:06.935964+00	2026-06-12 19:37:06.935964+00	\N	2026-06-12 19:37:06.951+00	f
141	73	{"name": "Еще один", "client": 22}	\N	2026-06-12 19:37:52.352007+00	2026-06-12 19:37:52.352007+00	\N	2026-06-12 19:37:52.354+00	f
142	73	{"name": "и еще", "client": 22}	\N	2026-06-12 19:42:27.43963+00	2026-06-12 19:42:27.43963+00	\N	2026-06-12 19:42:27.443+00	f
143	73	{"name": "вот еще один", "client": 22}	\N	2026-06-12 19:47:13.871846+00	2026-06-12 19:47:13.871846+00	\N	2026-06-12 19:47:13.874+00	f
144	73	{"name": "тут проект", "client": 22}	\N	2026-06-12 19:52:55.942882+00	2026-06-12 19:52:55.942882+00	\N	2026-06-12 19:52:55.946+00	f
152	73	{"name": "Еще один хороший проект", "client": 43}	\N	2026-06-30 14:23:01.044609+00	2026-06-30 14:23:01.044609+00	\N	2026-06-30 14:23:01.054+00	f
146	74	{"drawing": {"url": "https://drive.google.com/file/d/1HB2LM0tYkc9WMxIj3pyBqiCbfcSYlZoB", "kind": "link"}, "painter": "צביע באפוקול", "designer": 23, "order_file": {"url": "https://docs.google.com/document/d/1N5q1u-b57fWg6iJsbfJscJ17w-ZTCtUEI_5kyI4gKVI", "kind": "link"}, "dwg_drawings": {"url": "https://drive.google.com/file/d/1JQ8D8ygpY1NYz_caPHmRKcFojvVWW0mD", "kind": "link"}, "manufacturer": 14, "order_number": "3611", "painting_order": {"url": "https://docs.google.com/document/d/1hSLn9thCpasplaDpnihJyHiNdkX-Tw3AWc8sKlsYa1g", "kind": "link"}, "production_date": "2026-02-24", "production_order": {"url": "https://docs.google.com/document/d/1X9_5-eAmCG9YUzePJK2kb1yvQkaiOBL1okgT69SZmZ0", "kind": "link"}}	\N	2026-06-14 06:00:43.337104+00	2026-06-30 15:28:26.047+00	\N	2026-06-14 06:00:43.393+00	f
\.


--
-- Data for Name: entity_statuses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.entity_statuses (id, entity_id, status_key, name_json, color, is_default, is_final, sort_order, is_active, created_at, updated_at, is_archive_trigger, archive_after_days) FROM stdin;
59	75	gotovo_k_otpravke_na_obekt	{"ru": "Готово к отправке на объект"}	#8b5cf6	f	f	2	t	2026-06-30 20:31:40.290188+00	2026-06-30 20:36:21.274+00	f	0
60	75	vyehalo_na_obekt	{"ru": "Выехало на объект"}	#10b981	f	t	3	t	2026-06-30 20:32:15.370581+00	2026-06-30 20:36:21.274+00	t	5
58	75	dotsavleno_na_pokrasku	{"ru": "Дотсавлено на покраску"}	#f59e0b	t	f	1	t	2026-06-30 20:30:58.290615+00	2026-06-30 20:36:21.275+00	f	0
50	72	new	{"en": "New", "he": "חדש", "ru": "Новая запись"}	#6b7280	t	f	1	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	f	0
51	72	sent_to_manufacturer	{"en": "Sent to Manufacturer", "he": "נשלח ליצרן", "ru": "Передано производителю"}	#f59e0b	f	f	2	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	f	0
52	72	in_production	{"en": "In Production", "he": "בייצור", "ru": "В производстве"}	#3b82f6	f	f	3	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	f	0
53	72	ready	{"en": "Ready", "he": "מוכן", "ru": "Готово"}	#8b5cf6	f	f	4	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	f	0
54	72	sent_to_logistics	{"en": "Sent to Logistics", "he": "נשלח ללוגיסטיקה", "ru": "Передано в логистику"}	#06b6d4	f	f	5	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	f	0
55	72	delivered	{"en": "Delivered", "he": "נמסר", "ru": "Доставлено"}	#10b981	f	f	6	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	f	0
56	72	installed	{"en": "Installed", "he": "הותקן", "ru": "Смонтировано"}	#22c55e	f	f	7	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	f	0
57	72	closed	{"en": "Closed", "he": "סגור", "ru": "Закрыто"}	#1f2937	f	t	8	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	t	30
\.


--
-- Data for Name: entity_transitions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.entity_transitions (id, entity_id, from_status_id, to_status_id, name_json, allowed_role_ids, required_field_keys, actions_json, sort_order, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: google_drive_connection; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.google_drive_connection (id, key_mode, own_client_id, own_client_secret_enc, refresh_token_enc, account_email, folder_id, folder_name, created_at, updated_at) FROM stdin;
1	builtin	\N	\N	2Ep6K1SHJwH++cfuFtW4tQ==.n1g1vRMenCzCmNKV.q7wpGnZwqeGfk4X4h28J+w==.yRlw2/Zn2pJ92bgZ2OOyANivDcNic6mRwpQwGpkJeB9VMJOmKuBAiAlRJxVlZFhLp6ZiiB8sneYIAI4nU7xKi2AFw6q6/bnfyvTbMl/0hDPxfEk00/B1C8BJb3MSDP4UJNf2eiLgRg==	\N	1A6iSXVnnrhzulePSov7wp3WQV5BP3JGD	ERP Uploads	2026-06-07 12:49:23.542409+00	2026-06-08 13:43:11.187+00
\.


--
-- Data for Name: google_drive_folders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.google_drive_folders (id, drive_folder_id, name, sort_order, is_default, created_at, updated_at, parent_id) FROM stdin;
1	1ytJnh-GRELZMf8Aovyyebgus8Bw-I-uN	ERP	1	f	2026-06-08 16:07:23.529583+00	2026-06-08 16:07:23.529583+00	\N
2	1QHKCSoeEUurV59xoR2oxdOmBojwRRjvH	Азманот	2	f	2026-06-08 16:07:46.207924+00	2026-06-08 16:07:46.207924+00	1
3	1jnVxeqEsj1QnhYuIdhIuDplbB2TIz0Rl	Чертежи	3	f	2026-06-08 16:08:01.671571+00	2026-06-08 16:08:01.671571+00	1
4	13jIMt-GPWfSCNOUsxMVYS2QK2Iqb4TYW	Кабалот	4	f	2026-06-08 16:08:12.877192+00	2026-06-08 16:08:12.877192+00	1
\.


--
-- Data for Name: guest_links; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.guest_links (id, user_id, token_hash, label, expires_at, revoked_at, last_used_at, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: local_folders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.local_folders (id, storage_dir, name, sort_order, is_default, parent_id, created_at, updated_at) FROM stdin;
1	3cb34134-2f6c-4b44-892c-fe9f9145ce4f	Общая	0	t	\N	2026-07-07 18:58:10.088144+00	2026-07-07 18:58:10.088144+00
\.


--
-- Data for Name: login_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.login_history (id, user_id, ip_address, user_agent, created_at) FROM stdin;
1	1	127.0.0.1	curl/8.14.1	2026-06-04 18:09:50.590997+00
2	1	127.0.0.1	curl/8.14.1	2026-06-04 18:10:03.257951+00
3	1	127.0.0.1	curl/8.14.1	2026-06-04 18:11:00.201097+00
4	1	5.29.13.202	Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0	2026-06-04 18:18:13.131017+00
5	1	127.0.0.1	curl/8.14.1	2026-06-04 18:26:29.984048+00
6	1	127.0.0.1	curl/8.14.1	2026-06-04 18:26:39.513671+00
7	1	127.0.0.1	curl/8.14.1	2026-06-04 18:34:04.452563+00
8	1	127.0.0.1	curl/8.14.1	2026-06-04 18:49:10.02316+00
9	1	127.0.0.1	curl/8.14.1	2026-06-04 18:52:15.478645+00
42	1	127.0.0.1	curl/8.14.1	2026-06-04 19:05:49.786694+00
43	1	127.0.0.1	curl/8.14.1	2026-06-04 19:06:06.521459+00
44	1	127.0.0.1	curl/8.14.1	2026-06-04 19:06:24.147847+00
45	1	127.0.0.1	curl/8.14.1	2026-06-04 19:06:46.891685+00
46	1	127.0.0.1	curl/8.14.1	2026-06-04 19:11:10.033878+00
47	1	127.0.0.1	curl/8.14.1	2026-06-04 19:11:25.436539+00
48	1	127.0.0.1	curl/8.14.1	2026-06-04 19:11:52.684437+00
49	1	127.0.0.1	curl/8.14.1	2026-06-04 19:12:07.018288+00
50	1	127.0.0.1	curl/8.14.1	2026-06-04 19:12:26.517993+00
51	1	127.0.0.1	curl/8.14.1	2026-06-04 19:15:14.20893+00
52	1	127.0.0.1	curl/8.14.1	2026-06-04 19:25:25.600592+00
53	1	127.0.0.1	curl/8.14.1	2026-06-04 19:29:17.61445+00
54	1	127.0.0.1	curl/8.14.1	2026-06-04 19:29:34.446133+00
55	1	127.0.0.1	curl/8.14.1	2026-06-04 19:40:28.113829+00
56	1	127.0.0.1	curl/8.14.1	2026-06-04 19:44:02.454263+00
57	1	127.0.0.1	curl/8.14.1	2026-06-04 19:47:19.460588+00
58	1	127.0.0.1	curl/8.14.1	2026-06-04 19:47:49.280657+00
59	1	127.0.0.1	curl/8.14.1	2026-06-04 19:48:01.332838+00
60	1	127.0.0.1	curl/8.14.1	2026-06-04 19:59:42.298809+00
61	1	127.0.0.1	curl/8.14.1	2026-06-04 20:01:26.654984+00
62	1	127.0.0.1	curl/8.14.1	2026-06-04 20:05:53.971754+00
63	1	127.0.0.1	curl/8.14.1	2026-06-04 20:09:28.184929+00
64	1	127.0.0.1	curl/8.14.1	2026-06-04 20:09:57.259335+00
65	1	127.0.0.1	curl/8.14.1	2026-06-04 20:13:40.561103+00
66	1	127.0.0.1	curl/8.14.1	2026-06-04 20:28:20.027789+00
67	1	127.0.0.1	curl/8.14.1	2026-06-04 20:28:34.886662+00
68	1	127.0.0.1	curl/8.14.1	2026-06-04 20:28:58.518504+00
69	1	127.0.0.1	node	2026-06-04 20:35:21.672191+00
70	1	127.0.0.1	node	2026-06-04 20:35:38.254484+00
71	1	127.0.0.1	node	2026-06-04 20:36:12.019412+00
72	1	127.0.0.1	node	2026-06-04 20:55:31.027942+00
73	1	127.0.0.1	node	2026-06-04 20:56:09.536873+00
74	4	127.0.0.1	node	2026-06-04 20:56:09.711447+00
75	1	127.0.0.1	curl/8.14.1	2026-06-04 21:01:38.425704+00
76	1	127.0.0.1	curl/8.14.1	2026-06-04 21:01:49.868023+00
77	1	127.0.0.1	curl/8.14.1	2026-06-04 21:01:57.346017+00
78	1	127.0.0.1	curl/8.14.1	2026-06-04 21:57:10.732266+00
79	1	127.0.0.1	curl/8.14.1	2026-06-04 21:57:18.064266+00
80	1	127.0.0.1	curl/8.14.1	2026-06-04 22:04:03.121924+00
81	1	127.0.0.1	curl/8.14.1	2026-06-04 22:08:45.913697+00
82	1	127.0.0.1	curl/8.14.1	2026-06-04 22:13:22.312765+00
83	1	127.0.0.1	curl/8.14.1	2026-06-04 22:13:32.190591+00
84	1	127.0.0.1	curl/8.14.1	2026-06-05 05:36:56.761564+00
85	1	127.0.0.1	curl/8.14.1	2026-06-05 05:37:04.449406+00
86	1	127.0.0.1	curl/8.14.1	2026-06-05 05:37:19.762849+00
87	1	127.0.0.1	curl/8.14.1	2026-06-05 05:38:29.119184+00
88	1	127.0.0.1	curl/8.14.1	2026-06-05 05:38:51.829887+00
89	1	127.0.0.1	curl/8.14.1	2026-06-05 05:38:59.596292+00
90	1	127.0.0.1	curl/8.14.1	2026-06-05 05:39:10.927722+00
91	1	127.0.0.1	curl/8.14.1	2026-06-05 05:39:20.338244+00
92	1	127.0.0.1	curl/8.14.1	2026-06-05 05:39:35.807125+00
93	5	127.0.0.1	curl/8.14.1	2026-06-05 05:39:36.087926+00
94	1	127.0.0.1	curl/8.14.1	2026-06-05 05:48:40.894252+00
95	1	127.0.0.1	curl/8.14.1	2026-06-05 05:48:52.818744+00
96	1	127.0.0.1	curl/8.14.1	2026-06-05 05:49:03.776423+00
97	1	127.0.0.1	curl/8.14.1	2026-06-05 05:49:32.107561+00
98	1	127.0.0.1	curl/8.14.1	2026-06-05 05:50:06.379732+00
99	6	127.0.0.1	curl/8.14.1	2026-06-05 05:50:06.897716+00
100	1	127.0.0.1	curl/8.14.1	2026-06-05 06:08:26.244113+00
101	1	127.0.0.1	curl/8.14.1	2026-06-05 06:08:39.925199+00
102	1	127.0.0.1	curl/8.14.1	2026-06-05 06:08:51.185681+00
103	1	127.0.0.1	curl/8.14.1	2026-06-05 06:09:06.303708+00
104	1	127.0.0.1	curl/8.14.1	2026-06-05 06:15:56.196678+00
105	1	127.0.0.1	curl/8.14.1	2026-06-05 06:19:43.918775+00
106	1	127.0.0.1	curl/8.14.1	2026-06-05 07:05:06.613721+00
107	1	127.0.0.1	curl/8.14.1	2026-06-05 07:10:45.79411+00
108	1	127.0.0.1	curl/8.14.1	2026-06-05 07:10:59.759952+00
109	1	127.0.0.1	curl/8.14.1	2026-06-05 07:11:13.801547+00
110	1	127.0.0.1	curl/8.14.1	2026-06-05 07:11:24.02396+00
111	1	127.0.0.1	curl/8.14.1	2026-06-05 07:11:41.91567+00
112	1	127.0.0.1	curl/8.14.1	2026-06-05 07:11:49.850096+00
113	1	127.0.0.1	node	2026-06-05 07:13:07.10825+00
114	7	127.0.0.1	node	2026-06-05 07:13:07.351697+00
115	1	127.0.0.1	curl/8.14.1	2026-06-05 10:37:46.084804+00
116	1	34.47.174.15	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2026-06-05 11:04:39.38886+00
117	1	34.47.174.15	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2026-06-05 11:10:03.344178+00
118	1	127.0.0.1	curl/8.14.1	2026-06-05 13:30:43.155111+00
119	1	8.231.105.66	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2026-06-05 13:32:00.61859+00
120	1	127.0.0.1	curl/8.14.1	2026-06-05 13:33:37.209311+00
121	1	8.231.105.66	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2026-06-05 13:34:28.003771+00
122	1	127.0.0.1	curl/8.14.1	2026-06-05 13:38:13.126323+00
123	1	127.0.0.1	curl/8.14.1	2026-06-05 13:58:40.356736+00
124	1	127.0.0.1	curl/8.14.1	2026-06-05 13:58:53.068646+00
125	1	127.0.0.1	curl/8.14.1	2026-06-05 14:13:17.600308+00
126	1	127.0.0.1	Python-urllib/3.11	2026-06-05 14:16:16.655861+00
127	1	127.0.0.1	Python-urllib/3.11	2026-06-05 14:16:26.261617+00
128	1	127.0.0.1	Python-urllib/3.11	2026-06-05 14:16:35.852362+00
129	1	127.0.0.1	Python-urllib/3.11	2026-06-05 14:16:50.270148+00
130	1	127.0.0.1	Python-urllib/3.11	2026-06-05 14:17:08.929675+00
131	9	127.0.0.1	Python-urllib/3.11	2026-06-05 14:17:09.196616+00
132	1	127.0.0.1	Python-urllib/3.11	2026-06-05 14:22:01.147121+00
133	1	127.0.0.1	Python-urllib/3.11	2026-06-05 14:23:13.435536+00
134	1	127.0.0.1	Python-urllib/3.11	2026-06-05 14:32:48.898588+00
135	1	127.0.0.1	Python-urllib/3.11	2026-06-05 14:36:41.902906+00
136	10	127.0.0.1	Python-urllib/3.11	2026-06-05 14:36:42.215284+00
137	1	127.0.0.1	Python-urllib/3.11	2026-06-05 14:44:48.174551+00
138	1	8.231.105.66	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2026-06-05 15:43:51.283256+00
139	1	127.0.0.1	curl/8.14.1	2026-06-05 16:29:06.848848+00
140	1	127.0.0.1	curl/8.14.1	2026-06-05 16:29:16.423711+00
141	1	127.0.0.1	curl/8.14.1	2026-06-05 16:29:33.722325+00
142	1	127.0.0.1	curl/8.14.1	2026-06-05 16:30:16.203359+00
143	1	127.0.0.1	curl/8.14.1	2026-06-05 16:30:49.057543+00
146	1	127.0.0.1	undici	2026-06-05 19:45:14.783747+00
147	2	127.0.0.1	undici	2026-06-05 19:51:55.817153+00
148	2	127.0.0.1	undici	2026-06-05 19:52:54.075639+00
149	1	127.0.0.1	undici	2026-06-05 19:55:14.789998+00
150	1	127.0.0.1	undici	2026-06-05 19:56:22.053169+00
151	2	127.0.0.1	undici	2026-06-05 19:57:03.399802+00
152	1	127.0.0.1	undici	2026-06-05 19:58:18.832552+00
153	1	127.0.0.1	undici	2026-06-05 19:59:41.727513+00
154	13	127.0.0.1	undici	2026-06-05 19:59:41.89788+00
155	1	127.0.0.1	undici	2026-06-05 20:00:41.372462+00
156	1	127.0.0.1	undici	2026-06-05 20:02:34.139007+00
157	1	127.0.0.1	undici	2026-06-05 20:04:40.813229+00
158	1	127.0.0.1	undici	2026-06-05 20:05:40.69146+00
159	1	127.0.0.1	undici	2026-06-06 18:11:03.835418+00
160	1	5.29.13.202	Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0	2026-06-07 20:55:37.408139+00
161	1	5.29.13.202	Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0	2026-06-08 07:40:23.883234+00
162	1	213.57.197.14	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	2026-06-08 19:04:07.640712+00
163	14	127.0.0.1	curl/8.14.1	2026-06-08 20:48:34.507497+00
164	14	127.0.0.1	curl/8.14.1	2026-06-08 20:48:45.42372+00
165	1	5.29.13.202	Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0	2026-06-18 21:45:35.355498+00
166	1	5.29.13.202	Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0	2026-06-21 20:30:44.967706+00
167	1	5.29.13.202	Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0	2026-06-22 19:42:54.306897+00
168	1	213.57.197.14	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	2026-06-23 06:35:53.528244+00
169	1	5.29.9.103	Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0	2026-06-30 14:11:18.756484+00
170	1	127.0.0.1	curl/8.14.1	2026-07-02 14:22:28.027208+00
171	1	127.0.0.1	curl/8.14.1	2026-07-02 14:22:45.463642+00
172	1	127.0.0.1	curl/8.14.1	2026-07-02 14:28:38.156733+00
173	1	127.0.0.1	curl/8.14.1	2026-07-02 14:29:16.749831+00
174	1	127.0.0.1	node	2026-07-02 14:29:38.47596+00
175	1	127.0.0.1	node	2026-07-02 14:29:44.352908+00
176	44	127.0.0.1	node	2026-07-02 14:29:44.772073+00
177	1	5.29.9.103	Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0	2026-07-02 18:41:20.805221+00
178	1	127.0.0.1	curl/8.14.1	2026-07-02 19:05:13.701529+00
179	1	127.0.0.1	curl/8.14.1	2026-07-02 19:05:32.421372+00
180	1	127.0.0.1	curl/8.14.1	2026-07-02 19:05:55.808933+00
181	1	127.0.0.1	curl/8.14.1	2026-07-02 19:11:42.767903+00
182	1	8.231.94.27	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2026-07-02 19:12:48.097624+00
183	1	8.231.94.27	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2026-07-02 19:15:55.406404+00
184	1	8.231.94.27	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2026-07-02 19:40:00.907302+00
185	1	8.231.94.27	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2026-07-02 19:46:12.888899+00
186	1	127.0.0.1	curl/8.14.1	2026-07-02 19:50:51.656597+00
187	1	127.0.0.1	curl/8.14.1	2026-07-02 20:11:48.09693+00
188	1	127.0.0.1	curl/8.14.1	2026-07-02 20:12:29.494578+00
189	1	127.0.0.1	undici	2026-07-05 19:56:40.097169+00
190	1	127.0.0.1	undici	2026-07-05 19:56:49.230876+00
191	1	127.0.0.1	undici	2026-07-05 19:56:59.627322+00
192	1	127.0.0.1	undici	2026-07-05 19:57:09.003426+00
193	1	127.0.0.1	undici	2026-07-05 19:57:18.058309+00
194	1	127.0.0.1	undici	2026-07-05 19:57:46.287561+00
195	1	127.0.0.1	undici	2026-07-05 20:03:28.660967+00
196	1	127.0.0.1	undici	2026-07-05 20:04:45.580598+00
197	1	127.0.0.1	undici	2026-07-05 20:11:07.872547+00
198	1	213.57.197.14	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	2026-07-06 19:23:46.467202+00
199	1	5.29.9.103	Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0	2026-07-07 16:04:07.501634+00
\.


--
-- Data for Name: modules; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.modules (id, module_key, name_json, version, is_enabled, settings_json, created_at, updated_at) FROM stdin;
3	google_drive	{"en": "Google Drive", "he": "Google Drive", "ru": "Google Диск"}	1.0.0	t	{}	2026-06-07 13:21:33.499119+00	2026-06-07 13:24:12.082+00
\.


--
-- Data for Name: page_fields; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.page_fields (id, page_id, field_key, name_json, description_json, field_type, is_required, default_value, options_json, format_rules_json, show_in_table, sort_order, is_active, created_at, updated_at, formula_config_json, show_column_total, total_fill_color, total_text_color, relation_config_json, permissions_json, is_pinned, is_filterable, pivot_enabled, column_group_id, percent_config_json) FROM stdin;
38	77	status_epokol	{"ru": "Статус в эпоколь"}	{}	select	f	\N	[{"value": "בשטח לפני צבע", "labelJson": {"ru": "בשטח לפני צבע"}}, {"value": "בצבע", "labelJson": {"ru": "בצבע"}}, {"value": "מוקפא", "labelJson": {"ru": "מוקפא"}}, {"value": "לצבוע דחוף", "labelJson": {"ru": "לצבוע דחוף"}}, {"value": "מוכנ חלקי//פסולים", "labelJson": {"ru": "מוכנ חלקי//פסולים"}}, {"value": "יצאה לאתר", "labelJson": {"ru": "יצאה לאתר"}}, {"value": "יצאה חלקי", "labelJson": {"ru": "יצאה חלקי"}}, {"value": "מוכן להובלה", "labelJson": {"ru": "מוכן להובלה"}}]	[]	t	1	t	2026-06-17 10:44:02.490334+00	2026-06-17 19:31:31.524+00	{}	f	\N	\N	{}	{}	f	t	t	\N	{}
45	81	tip_oplaty	{"ru": "Тип оплаты"}	{}	select	t	\N	[{"value": "Кабланут", "labelJson": {"ru": "Кабланут"}}, {"value": "Емит 2000", "labelJson": {"ru": "Емит 2000"}}, {"value": "Емит 1000", "labelJson": {"ru": "Емит 1000"}}, {"value": "По часам", "labelJson": {"ru": "По часам"}}, {"value": "Договор", "labelJson": {"ru": "Договор"}}]	[{"value": "Кабланут", "operator": "equals", "rowColor": "", "cellColor": "#D4EDBC"}, {"value": "Емит 2000", "operator": "equals", "rowColor": "", "cellColor": "#E6CFF2"}, {"value": "Емит 1000", "operator": "equals", "rowColor": "", "cellColor": "#E8EAED"}, {"value": "По часам", "operator": "equals", "rowColor": "", "cellColor": "#FFE5A0"}, {"value": "Договор", "operator": "equals", "rowColor": "", "cellColor": "#11734B", "textColor": "#ffffff"}]	t	1	t	2026-07-05 19:07:20.491316+00	2026-07-05 19:45:38.421+00	{}	f	\N	\N	{}	{}	f	t	f	\N	{}
46	81	stavka	{"ru": "Ставка"}	{}	number	t	\N	[]	[]	t	2	t	2026-07-05 19:09:23.759644+00	2026-07-05 19:09:23.759644+00	{}	f	\N	\N	{}	{}	f	f	f	\N	{}
47	81	dni_chasy	{"ru": "Дни/Часы"}	{}	number	t	1	[]	[]	t	3	t	2026-07-05 19:10:19.104311+00	2026-07-05 19:10:19.104311+00	{}	f	\N	\N	{}	{}	f	f	f	\N	{}
51	81	k_oplate	{"ru": "К оплате"}	{}	function	f	\N	[]	[{"value": "0", "operator": "gt", "rowColor": "", "cellColor": "#ff0000", "textColor": "#FFFFFF"}]	t	7	t	2026-07-05 21:33:11.525099+00	2026-07-05 21:48:33.616+00	{"decimals": 2, "expression": "if({stoimost_montazha} != 0, {stoimost_montazha}*({vypolneniya}/100)-{oplacheno}, 0)"}	t	#ff0000	#ffffff	{}	{}	f	f	f	\N	{}
42	77	summavse	{"ru": "суммавсе"}	{}	number	f	\N	[]	[]	t	2	t	2026-06-17 19:05:13.362148+00	2026-06-17 19:05:13.362148+00	{}	t	\N	\N	{}	{}	f	f	t	\N	{}
49	81	stoimost_montazha	{"ru": "Стоимость монтажа"}	{}	function	f	\N	[]	[]	t	5	t	2026-07-05 19:34:54.580435+00	2026-07-05 20:16:45.494+00	{"decimals": 2, "expression": "if({tip_oplaty} == \\"Кабланут\\", {quantity}*{stavka}, {stavka}*{dni_chasy})"}	t	#F7F7B9	#000000	{}	{}	f	f	f	\N	{}
52	81	installation_team	{"en": "Installation Team", "he": "צבת מתינים", "ru": "Монтажная бригада"}	{}	select	f	\N	[{"value": "Леша+Купра", "labelJson": {"ru": "Леша+Купра"}}, {"value": "Миша+Володя", "labelJson": {"ru": "Миша+Володя"}}, {"value": "Иван+Слава", "labelJson": {"ru": "Иван+Слава"}}, {"value": "Александр+Ваня", "labelJson": {"ru": "Александр+Ваня"}}, {"value": "Костя+Наиль", "labelJson": {"ru": "Костя+Наиль"}}, {"value": "Каблан мишнэ", "labelJson": {"ru": "Каблан мишнэ"}}, {"value": "Саша Рыж+Паша", "labelJson": {"ru": "Саша Рыж+Паша"}}, {"value": "Махди", "labelJson": {"ru": "Махди"}}, {"value": "Семен", "labelJson": {"ru": "Семен"}}, {"value": "Каблан", "labelJson": {"ru": "Каблан"}}]	[{"value": "Леша+Купра", "operator": "equals", "rowColor": "", "cellColor": "#FEE2E2"}, {"value": "Миша+Володя", "operator": "equals", "rowColor": "", "cellColor": "#E8D9B8"}, {"value": "Иван+Слава", "operator": "equals", "rowColor": "", "cellColor": "#D8F1F9"}, {"value": "Александр+Ваня", "operator": "equals", "rowColor": "", "cellColor": "#FAADAD"}, {"value": "Костя+Наиль", "operator": "equals", "rowColor": "", "cellColor": "#DDD4D4"}, {"value": "Каблан мишнэ", "operator": "equals", "rowColor": "", "cellColor": "#EEFFB4"}, {"value": "Саша Рыж+Паша", "operator": "equals", "rowColor": "", "cellColor": "#AEEFFA"}, {"value": "Махди", "operator": "equals", "rowColor": "", "cellColor": "#C8E1C1"}, {"value": "Семен", "operator": "equals", "rowColor": "", "cellColor": "#D8D4FC"}, {"value": "Каблан", "operator": "equals", "rowColor": "", "cellColor": "#F6FF8C"}]	t	8	t	2026-07-06 07:15:06.841021+00	2026-07-06 07:15:06.841021+00	{}	f	\N	\N	{}	{}	f	t	f	\N	{}
50	81	oplacheno	{"ru": "Оплачено"}	{}	number	f	0	[]	[]	t	6	t	2026-07-05 21:04:26.87297+00	2026-07-06 08:24:18.007+00	{}	t	#00b94a	#ffffff	{}	{}	f	f	f	\N	{}
53	81	data_nachala_rabot	{"ru": "Дата начала работ"}	{}	date	t	\N	[]	[]	t	9	t	2026-07-07 06:57:37.347377+00	2026-07-07 10:12:10.059+00	{}	f	\N	\N	{}	{}	f	f	f	\N	{}
48	81	vypolneniya	{"ru": "% выполнения"}	{}	percent	f	\N	[{"value": "30", "labelJson": {"ru": "30%"}}, {"value": "40", "labelJson": {"ru": "40%"}}, {"value": "50", "labelJson": {"ru": "50%"}}, {"value": "60", "labelJson": {"ru": "60%"}}, {"value": "70", "labelJson": {"ru": "70%"}}, {"value": "80", "labelJson": {"ru": "80%"}}, {"value": "90", "labelJson": {"ru": "90%"}}, {"value": "100", "labelJson": {"ru": "100%"}}]	[{"value": "100", "operator": "equals", "rowColor": "", "cellColor": "#D4EDBC"}, {"value": "70", "operator": "equals", "rowColor": "", "cellColor": "#FFE5A0"}, {"value": "50", "operator": "equals", "rowColor": "", "cellColor": "#E6CFF2"}]	t	4	t	2026-07-05 19:11:49.165763+00	2026-07-06 09:44:00.362+00	{}	f	\N	\N	{}	{}	f	f	f	\N	{"mode": "list", "decimals": 0}
54	81	data_okonchaniya_rabot	{"ru": "Дата окончания работ"}	{}	date	f	\N	[]	[]	t	10	t	2026-07-07 06:58:16.417831+00	2026-07-07 10:12:14.44+00	{}	f	\N	\N	{}	{}	f	f	f	\N	{}
\.


--
-- Data for Name: page_record_values; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.page_record_values (id, page_id, record_id, values_json, created_at, updated_at) FROM stdin;
4	81	151	{"stavka": 200, "dni_chasy": 5, "oplacheno": 1000, "tip_oplaty": "Кабланут", "vypolneniya": 50, "installation_team": "Костя+Наиль", "data_nachala_rabot": "2026-07-07", "data_okonchaniya_rabot": "2026-07-09"}	2026-07-02 18:59:50.781684+00	2026-07-07 07:03:58.719+00
3	77	148	{"summavse": 50, "status_epokol": "בשטח לפני צבע"}	2026-06-17 10:44:17.120056+00	2026-06-17 19:05:20.212+00
6	81	148	{"stavka": 220, "dni_chasy": 1, "tip_oplaty": "Кабланут", "vypolneniya": 70, "installation_team": "Костя+Наиль", "data_nachala_rabot": "2026-07-07", "data_okonchaniya_rabot": "2026-07-09"}	2026-07-02 18:59:54.246853+00	2026-07-07 07:03:58.723+00
5	81	150	{"stavka": 150, "dni_chasy": 1, "oplacheno": 1650, "tip_oplaty": "Кабланут", "vypolneniya": 100, "installation_team": "Костя+Наиль", "data_nachala_rabot": "2026-07-07", "data_okonchaniya_rabot": "2026-07-09"}	2026-07-02 18:59:52.572313+00	2026-07-07 07:03:58.736+00
11	81	158	{"stavka": 2000, "dni_chasy": 1, "oplacheno": 2000, "tip_oplaty": "Емит 2000", "vypolneniya": 100, "installation_team": "Леша+Купра", "data_nachala_rabot": "2026-06-29", "data_okonchaniya_rabot": "2026-07-01"}	2026-07-06 08:04:46.929914+00	2026-07-07 07:04:56.319+00
\.


--
-- Data for Name: pages; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.pages (id, name_json, description_json, icon, parent_page_id, sort_order, is_active, created_at, updated_at, path, mirror_entity_id, mirror_field_keys_json, is_dashboard, widgets_collapsed_default, mirror_field_labels_json, is_pivot, pivot_entity_id, pivot_config_json, mirror_column_order_json, column_groups_json, default_quick_filter_json, group_by_field_key, mirror_pinned_json, group_default_expanded) FROM stdin;
64	{"en": "Project Management", "he": "ניהול פרויקטים", "ru": "Управление проектами"}	{}	table	\N	1	t	2026-06-08 21:01:23.18805+00	2026-06-14 07:01:10.465+00	/upravlenie-proektami	\N	\N	f	t	\N	f	\N	\N	\N	\N	\N	\N	\N	f
65	{"en": "Logistics", "he": "לוגיסטיקה", "ru": "Логистика"}	{}	truck	\N	2	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	/logistika	72	["project_name", "item_name", "order_number", "manufacturer", "manufacturer_order_number", "production_status", "production_finish_date", "painter", "paint_status", "paint_finish_date", "driver", "delivery_status", "delivery_date", "delivery_cost", "comments"]	f	f	\N	f	\N	\N	\N	\N	\N	\N	\N	f
67	{"en": "Administration", "he": "ניהול", "ru": "Администрирование"}	{}	settings	\N	100	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	\N	\N	\N	f	f	\N	f	\N	\N	\N	\N	\N	\N	\N	f
68	{"en": "Pages", "he": "דפים", "ru": "Страницы"}	{}	files	67	101	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	/admin/pages	\N	\N	f	f	\N	f	\N	\N	\N	\N	\N	\N	\N	f
69	{"en": "Entities", "he": "ישויות", "ru": "Сущности"}	{}	database	67	102	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	/admin/entities	\N	\N	f	f	\N	f	\N	\N	\N	\N	\N	\N	\N	f
70	{"en": "Users", "he": "משתמשים", "ru": "Пользователи"}	{}	users	67	103	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	/admin/users	\N	\N	f	f	\N	f	\N	\N	\N	\N	\N	\N	\N	f
71	{"en": "Roles & Permissions", "he": "תפקידים והרשאות", "ru": "Роли и права"}	{}	shield	67	104	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	/admin/roles	\N	\N	f	f	\N	f	\N	\N	\N	\N	\N	\N	\N	f
72	{"en": "Translations", "he": "תרגומים", "ru": "Переводы"}	{}	languages	67	105	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	/admin/translations	\N	\N	f	f	\N	f	\N	\N	\N	\N	\N	\N	\N	f
73	{"en": "Events", "he": "אירועים", "ru": "События"}	{}	activity	67	106	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	/admin/events	\N	\N	f	f	\N	f	\N	\N	\N	\N	\N	\N	\N	f
74	{"en": "Modules", "he": "מודולים", "ru": "Модули"}	{}	puzzle	67	107	t	2026-06-08 21:01:23.18805+00	2026-06-08 21:01:23.18805+00	/admin/modules	\N	\N	f	f	\N	f	\N	\N	\N	\N	\N	\N	\N	f
76	{"ru": "Панель управления"}	{}		\N	0	t	2026-06-09 09:14:21.650088+00	2026-06-09 09:14:21.650088+00	/	\N	\N	t	f	\N	f	\N	\N	\N	\N	\N	\N	\N	f
77	{"ru": "Эпоколь"}	{}	pencil	\N	14	t	2026-06-17 10:41:17.889278+00	2026-06-17 10:41:17.889278+00	/epokol	72	["project_manager", "project_name", "item_name", "order_number", "drawing", "ral_color", "quantity"]	f	f	\N	f	\N	\N	\N	\N	\N	\N	\N	f
75	{"en": "File Trash", "he": "סל קבצים", "ru": "Корзина файлов"}	{}	trash	67	109	t	2026-06-08 21:01:23.18805+00	2026-06-21 17:42:28.800763+00	/admin/file-trash	\N	\N	f	f	\N	f	\N	\N	\N	\N	\N	\N	\N	f
78	{"en": "Column Groups", "he": "קבוצות עמודות", "ru": "Группы колонок"}	{}	columns	67	108	t	2026-06-21 17:42:28.800763+00	2026-06-21 17:42:28.800763+00	/admin/column-groups	\N	\N	f	f	\N	f	\N	\N	\N	\N	\N	\N	\N	f
79	{"en": "Delivery", "he": "משלוח", "ru": "Доставка"}	{}	truck	\N	16	t	2026-06-30 16:15:21.230278+00	2026-06-30 16:15:21.230278+00	/delivery	\N	\N	f	f	\N	f	\N	\N	\N	\N	\N	\N	\N	f
80	{"en": "Data Import", "he": "ייבוא נתונים", "ru": "Импорт данных"}	{}	upload	67	108	t	2026-06-30 16:26:42.972056+00	2026-06-30 16:26:42.972056+00	/admin/import	\N	\N	f	f	\N	f	\N	\N	\N	\N	\N	\N	\N	f
81	{"en": "Installation", "he": "התקנה", "ru": "Монтаж"}	{}	wrench	\N	18	t	2026-07-01 14:59:00.03861+00	2026-07-07 08:09:43.715+00	/installation	72	["project_name", "order_number", "item_name", "installation_team"]	f	f	\N	f	\N	\N	["e:order_number", "e:project_name", "e:item_name", "p:installation_team", "p:tip_oplaty", "p:data_nachala_rabot", "p:data_okonchaniya_rabot", "p:stavka", "p:dni_chasy", "p:vypolneniya", "p:stoimost_montazha", "p:oplacheno", "p:k_oplate"]	{"p:test": 5, "p:stavka": 5, "e:quantity": 5, "p:k_oplate": 5, "e:item_name": 5, "p:dni_chasy": 5, "p:oplacheno": 5, "p:tip_oplaty": 5, "p:vypolneniya": 5, "e:order_number": 5, "e:project_name": 5, "e:installation_team": 5, "p:installation_team": 5, "p:stoimost_montazha": 5, "p:data_nachala_rabot": 5, "p:data_okonchaniya_rabot": 5}	\N	order_number	{"e:order_number": true}	f
66	{"en": "Production", "he": "ייצור", "ru": "Производство"}	{}	factory	\N	3	t	2026-06-08 21:01:23.18805+00	2026-07-06 19:49:51.939+00	/proizvodstvo	72	["project_name", "item_name", "order_number", "drawing_link", "ral_color", "quantity", "manufacturer_order_number", "production_status", "drawing", "mnf_cost_unit", "production_cost", "materials_cost", "entry_date", "comments", "painter", "production_finish_date", "material_release_date", "makasa", "project_manager"]	f	f	{"mnf_cost_unit": {"en": "Cost per sq. m./unit.", "he": "עלות למ\\"א/מ\\"ר/יח", "ru": "Стоимость за м. кв./ед."}, "materials_cost": {"en": "DWG", "he": "DWG", "ru": "DWG"}, "production_cost": {"en": "Cost", "he": "עלות", "ru": "Стоимость"}}	f	\N	\N	["e:project_manager", "e:project_name", "e:item_name", "e:order_number", "e:drawing", "e:ral_color", "e:materials_cost", "e:quantity", "e:mnf_cost_unit", "e:production_cost", "e:entry_date", "e:manufacturer_order_number", "e:painter", "e:production_status", "e:production_finish_date", "e:comments", "e:material_release_date", "e:makasa"]	\N	{"excludeFieldFilters": {"production_status": ["יצאיה לישראל"]}}	\N	\N	f
\.


--
-- Data for Name: record_links; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.record_links (id, relation_id, relation_type, source_record_id, target_record_id, created_at) FROM stdin;
56	24	many_to_one	148	140	2026-06-14 06:53:16.997886+00
76	24	many_to_one	150	140	2026-06-21 20:47:21.922723+00
63	25	many_to_one	148	146	2026-06-14 10:16:22.173194+00
69	26	many_to_one	148	148	2026-06-17 18:56:00.754087+00
58	23	many_to_one	146	140	2026-06-14 08:21:20.150123+00
77	25	many_to_one	150	146	2026-06-21 20:48:12.3289+00
78	24	many_to_one	151	140	2026-06-21 20:59:07.106155+00
79	25	many_to_one	151	146	2026-06-21 20:59:07.259061+00
82	28	many_to_one	155	146	2026-07-01 09:01:29.534173+00
84	23	many_to_one	157	152	2026-07-05 19:55:57.592665+00
85	24	many_to_one	158	152	2026-07-05 19:56:08.344415+00
86	25	many_to_one	158	157	2026-07-05 19:56:08.553783+00
87	23	many_to_one	160	159	2026-07-06 19:40:08.808753+00
88	24	many_to_one	161	159	2026-07-06 19:46:04.5667+00
89	25	many_to_one	161	160	2026-07-06 19:46:04.998525+00
90	28	many_to_one	162	160	2026-07-06 20:15:05.933681+00
91	28	many_to_one	163	160	2026-07-06 20:17:19.05572+00
\.


--
-- Data for Name: relations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.relations (id, source_entity_id, target_entity_id, relation_key, relation_type, name_json, inverse_name_json, settings_json, created_at, updated_at) FROM stdin;
24	72	73	proekty	many_to_one	{"ru": "Проекты"}	{}	{}	2026-06-12 07:53:38.368236+00	2026-06-21 20:40:09.496+00
25	72	74	zakazy	many_to_one	{"ru": "Заказы"}	{}	{}	2026-06-12 07:54:54.80837+00	2026-06-21 20:47:47.813+00
26	72	72	izdelie	many_to_one	{"ru": "Изделие"}	{}	{}	2026-06-17 18:09:43.906787+00	2026-06-21 20:47:52.927+00
23	74	73	proekty	many_to_one	{"ru": "Проекты"}	{}	{}	2026-06-12 06:24:17.424883+00	2026-06-21 20:48:04.807+00
27	75	72	izdeliya	many_to_one	{"ru": "Изделия"}	{}	{}	2026-06-30 16:17:23.054707+00	2026-06-30 17:13:48.508+00
28	75	74	zakazy	many_to_one	{"ru": "Заказы"}	{}	{}	2026-06-30 16:17:45.014783+00	2026-06-30 17:13:54.446+00
29	75	73	proekty	many_to_one	{"ru": "Проекты"}	{}	{}	2026-06-30 16:17:55.979258+00	2026-06-30 17:14:00.2+00
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.roles (id, name_json, description_json, created_at, updated_at, permissions_json) FROM stdin;
12	{"en": "", "he": "", "ru": "Логист"}	{"en": "", "he": "", "ru": "Организация логистики от производства до объекта"}	2026-06-09 08:15:02.965799+00	2026-06-09 08:16:19.958+00	{"admin": {"pages": false, "roles": false, "users": false, "events": false, "modules": false, "entities": false, "settings": false, "googleDrive": false, "translations": false}, "pageIds": [65], "records": {"mirror:65": {"view": true, "create": false, "delete": false, "update": true}}, "superAdmin": false}
4	{"en": "Manufacturer", "he": "יצרן", "ru": "Производитель"}	{"en": "Manufacturing staff", "he": "צוות ייצור", "ru": "Производственный персонал"}	2026-06-04 17:59:52.972154+00	2026-06-19 11:33:20.645+00	{"admin": {"pages": false, "roles": false, "users": false, "events": false, "modules": false, "entities": false, "settings": false, "automations": false, "googleDrive": false, "translations": false}, "pageIds": [66], "records": {"72": {"view": false, "scope": "own", "create": false, "delete": false, "update": false, "scopeFieldKeys": ["manufacturer"]}, "73": {"view": true, "create": false, "delete": false, "update": false}, "74": {"view": true, "scope": "own", "create": false, "delete": false, "update": false, "scopeFieldKeys": ["manufacturer"]}, "mirror:66": {"view": true, "scope": "own", "create": false, "delete": false, "update": true, "scopeFieldKeys": ["manufacturer"], "hideStatusColumn": true, "hideActionsColumn": true}}, "superAdmin": false}
2	{"ru": "Управляющий проектами"}	{"en": "Project management", "he": "ניהול פרויקטים", "ru": "Управление проектами"}	2026-06-04 17:59:52.972154+00	2026-06-10 11:06:49.49+00	{"admin": {"pages": false, "roles": false, "users": false, "events": false, "modules": false, "entities": false, "settings": false, "googleDrive": false, "translations": false}, "pageIds": [64, 65, 66], "records": {"72": {"view": true, "scope": "all", "create": true, "delete": true, "update": true, "hiddenStatusIds": [51], "hiddenRowStatusIds": [51]}, "mirror:65": {"view": true, "create": false, "delete": false, "update": false}}, "superAdmin": false}
3	{"en": "Manager", "he": "מנהל", "ru": "Менеджер"}	{"en": "General manager", "he": "מנהל כללי", "ru": "Общий менеджер"}	2026-06-04 17:59:52.972154+00	2026-06-08 21:01:23.255+00	{"admin": {"pages": false, "roles": false, "users": false, "events": false, "modules": false, "entities": false, "settings": false, "googleDrive": false, "translations": false}, "pageIds": [64], "records": {"72": {"view": true, "scope": "all", "create": true, "delete": false, "update": true}}, "superAdmin": false}
13	{"en": "", "he": "", "ru": "Проектировщик"}	{"en": "", "he": "", "ru": "Чертежи проектов"}	2026-06-09 15:17:53.383926+00	2026-06-14 07:09:02.76+00	{"admin": {"pages": false, "roles": false, "users": false, "events": false, "modules": false, "entities": false, "settings": false, "googleDrive": false, "translations": false}, "pageIds": [], "records": {}, "superAdmin": false}
1	{"en": "Administrator", "he": "מנהל מערכת", "ru": "Администратор"}	{"en": "Full system access", "he": "גישה מלאה למערכת", "ru": "Полный доступ к системе"}	2026-06-04 17:59:52.972154+00	2026-06-08 21:01:23.252+00	{"admin": {"pages": true, "roles": true, "users": true, "events": true, "modules": true, "entities": true, "settings": true, "googleDrive": true, "translations": true}, "pageIds": [64, 65, 66], "records": {"72": {"view": true, "scope": "all", "create": true, "delete": true, "update": true}}, "superAdmin": true}
5	{"en": "CFO", "he": "מנהל כספים", "ru": "Финансовый директор"}	{"en": "Financial management", "he": "ניהול פיננסי", "ru": "Финансовое управление"}	2026-06-04 17:59:52.972154+00	2026-06-08 21:01:23.256+00	{"admin": {"pages": false, "roles": false, "users": false, "events": false, "modules": false, "entities": false, "settings": false, "googleDrive": false, "translations": false}, "pageIds": [64, 65, 66], "records": {"72": {"view": true, "scope": "all", "create": false, "delete": false, "update": false}}, "superAdmin": false}
11	{"en": "Guest", "he": "אורח", "ru": "Гость"}	{}	2026-06-05 19:59:41.863911+00	2026-06-08 21:01:23.257+00	{"admin": {"pages": false, "roles": false, "users": false, "events": false, "modules": false, "entities": false, "settings": false, "googleDrive": false, "translations": false}, "pageIds": [], "records": {}, "superAdmin": false}
\.


--
-- Data for Name: system_events; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.system_events (id, event_name, entity_id, record_id, payload_json, created_at) FROM stdin;
81	user.created	\N	20	{"roleId": 2, "userId": 20, "actorUserId": 1}	2026-06-09 15:25:01.839369+00
82	user.created	\N	21	{"roleId": 1, "userId": 21, "actorUserId": 1}	2026-06-09 15:30:12.170422+00
83	user.created	\N	22	{"roleId": 11, "userId": 22, "actorUserId": 20}	2026-06-10 15:23:48.634663+00
84	record.created	72	130	{"statusId": 50, "actorUserId": 20}	2026-06-10 15:25:16.919345+00
85	record.deleted	72	130	{"actorUserId": 1}	2026-06-10 15:26:44.20542+00
86	record.created	72	131	{"statusId": 50, "actorUserId": 1}	2026-06-10 17:53:24.50635+00
87	record.created	72	132	{"statusId": 50, "actorUserId": 1}	2026-06-10 17:59:15.766725+00
88	record.deleted	72	132	{"actorUserId": 1}	2026-06-10 17:59:22.494731+00
89	record.deleted	72	131	{"actorUserId": 1}	2026-06-10 17:59:27.087909+00
90	record.created	72	133	{"statusId": 50, "actorUserId": 1}	2026-06-10 19:12:02.176788+00
91	record.deleted	72	133	{"actorUserId": 1}	2026-06-10 19:13:03.516006+00
92	record.created	72	134	{"statusId": 50, "actorUserId": 1}	2026-06-10 19:13:32.879306+00
93	record.created	72	135	{"statusId": 50, "actorUserId": 1}	2026-06-10 19:14:09.318586+00
94	record.deleted	72	135	{"actorUserId": 1}	2026-06-10 19:14:19.710533+00
95	record.deleted	72	134	{"actorUserId": 1}	2026-06-10 19:14:23.817064+00
96	record.created	72	136	{"statusId": 50, "actorUserId": 1}	2026-06-11 13:30:00.058231+00
97	record.deleted	72	136	{"actorUserId": 1}	2026-06-11 13:30:13.786597+00
98	record.created	72	137	{"statusId": 50, "actorUserId": 1}	2026-06-11 14:20:03.58658+00
99	record.deleted	72	137	{"actorUserId": 1}	2026-06-11 14:20:19.500734+00
100	record.created	72	138	{"statusId": 50, "actorUserId": 1}	2026-06-11 15:33:07.334307+00
101	record.created	72	139	{"statusId": 50, "actorUserId": 1}	2026-06-11 15:35:17.914583+00
102	record.updated	72	138	{"actorUserId": 1}	2026-06-11 15:36:07.264493+00
103	record.updated	72	138	{"actorUserId": 1}	2026-06-11 15:36:14.691707+00
104	record.updated	72	139	{"actorUserId": 1}	2026-06-11 15:39:07.438747+00
105	record.updated	72	138	{"actorUserId": 1}	2026-06-11 15:50:29.926915+00
106	record.updated	72	138	{"actorUserId": 1}	2026-06-11 15:50:39.315117+00
107	record.updated	72	138	{"actorUserId": 1}	2026-06-11 15:50:54.741244+00
108	record.updated	72	138	{"actorUserId": 1}	2026-06-11 15:51:10.156881+00
109	record.updated	72	138	{"actorUserId": 1}	2026-06-11 15:51:19.282459+00
110	record.deleted	72	139	{"actorUserId": 1}	2026-06-12 07:52:38.698386+00
111	record.deleted	72	138	{"actorUserId": 1}	2026-06-12 07:52:40.682034+00
112	record.created	73	140	{"statusId": null, "actorUserId": 1}	2026-06-12 19:37:07.438838+00
113	record.created	73	141	{"statusId": null, "actorUserId": 1}	2026-06-12 19:37:52.443879+00
114	record.created	73	142	{"statusId": null, "actorUserId": 1}	2026-06-12 19:42:27.481199+00
115	record.created	73	143	{"statusId": null, "actorUserId": 1}	2026-06-12 19:47:13.916014+00
116	record.created	73	144	{"statusId": null, "actorUserId": 1}	2026-06-12 19:52:55.966085+00
117	record.created	73	145	{"statusId": null, "actorUserId": 1}	2026-06-12 19:54:52.57123+00
118	user.created	\N	23	{"roleId": 13, "userId": 23, "actorUserId": 1}	2026-06-14 06:00:29.445404+00
119	record.created	74	146	{"statusId": null, "actorUserId": 1}	2026-06-14 06:00:43.409239+00
120	record.created	72	147	{"statusId": 50, "actorUserId": 1}	2026-06-14 06:03:02.023116+00
121	record.updated	72	147	{"actorUserId": 1}	2026-06-14 06:04:58.389664+00
122	record.deleted	72	147	{"actorUserId": 1}	2026-06-14 06:34:33.566061+00
123	record.created	72	148	{"statusId": 50, "actorUserId": 1}	2026-06-14 06:53:16.863033+00
124	record.updated	72	148	{"actorUserId": 1}	2026-06-14 07:04:38.272499+00
125	record.updated	72	148	{"actorUserId": 1}	2026-06-14 07:04:42.534602+00
126	record.updated	72	148	{"actorUserId": 1}	2026-06-14 07:04:54.297443+00
127	record.created	72	149	{"statusId": 50, "actorUserId": 1}	2026-06-14 09:27:12.28964+00
128	record.deleted	72	149	{"actorUserId": 1}	2026-06-14 10:03:54.765335+00
129	user.created	\N	24	{"roleId": 4, "userId": 24, "actorUserId": 1}	2026-06-14 14:34:02.294663+00
130	user.created	\N	25	{"roleId": 4, "userId": 25, "actorUserId": 1}	2026-06-14 14:34:56.858625+00
131	user.created	\N	26	{"roleId": 4, "userId": 26, "actorUserId": 1}	2026-06-14 14:35:24.867119+00
132	user.created	\N	27	{"roleId": 4, "userId": 27, "actorUserId": 1}	2026-06-14 14:36:02.770911+00
133	user.created	\N	28	{"roleId": 4, "userId": 28, "actorUserId": 1}	2026-06-14 14:36:30.089619+00
134	user.created	\N	29	{"roleId": 4, "userId": 29, "actorUserId": 1}	2026-06-14 14:37:15.180172+00
135	user.created	\N	30	{"roleId": 4, "userId": 30, "actorUserId": 1}	2026-06-14 14:37:48.41485+00
136	user.created	\N	31	{"roleId": 4, "userId": 31, "actorUserId": 1}	2026-06-14 14:38:31.697024+00
137	user.created	\N	32	{"roleId": 4, "userId": 32, "actorUserId": 1}	2026-06-14 14:39:16.644588+00
138	user.created	\N	33	{"roleId": 4, "userId": 33, "actorUserId": 1}	2026-06-14 14:39:55.072021+00
139	user.created	\N	34	{"roleId": 4, "userId": 34, "actorUserId": 1}	2026-06-14 14:40:25.273582+00
140	user.created	\N	35	{"roleId": 4, "userId": 35, "actorUserId": 1}	2026-06-14 14:40:50.58529+00
141	user.created	\N	36	{"roleId": 13, "userId": 36, "actorUserId": 1}	2026-06-14 14:41:42.605771+00
142	user.created	\N	37	{"roleId": 13, "userId": 37, "actorUserId": 1}	2026-06-14 14:42:09.761836+00
143	user.created	\N	38	{"roleId": 13, "userId": 38, "actorUserId": 1}	2026-06-14 14:42:36.98898+00
144	user.created	\N	39	{"roleId": 13, "userId": 39, "actorUserId": 1}	2026-06-14 14:43:32.883567+00
145	user.created	\N	40	{"roleId": 13, "userId": 40, "actorUserId": 1}	2026-06-14 14:44:24.297262+00
146	user.created	\N	41	{"roleId": 13, "userId": 41, "actorUserId": 1}	2026-06-14 14:44:57.540949+00
147	user.created	\N	42	{"roleId": 13, "userId": 42, "actorUserId": 1}	2026-06-14 14:45:30.51167+00
148	record.updated	74	146	{"actorUserId": 1}	2026-06-14 14:58:46.764231+00
149	record.updated	74	146	{"actorUserId": 1}	2026-06-14 14:58:53.249406+00
150	record.updated	74	146	{"actorUserId": 1}	2026-06-14 14:58:59.323007+00
151	record.updated	72	148	{"actorUserId": 14}	2026-06-15 14:30:33.904668+00
152	record.updated	72	148	{"actorUserId": 1}	2026-06-15 14:40:42.081019+00
153	record.updated	72	148	{"actorUserId": 1}	2026-06-15 14:41:23.387595+00
154	record.updated	72	148	{"actorUserId": 1}	2026-06-15 14:41:54.805412+00
155	record.updated	72	148	{"actorUserId": 1}	2026-06-15 14:47:48.723592+00
156	record.updated	72	148	{"actorUserId": 1}	2026-06-15 14:47:51.22732+00
157	record.updated	72	148	{"actorUserId": 1}	2026-06-15 14:47:53.405676+00
158	record.updated	72	148	{"actorUserId": 14}	2026-06-16 09:37:31.048979+00
159	status.changed	72	148	{"to": null, "from": 50, "actorUserId": 14}	2026-06-16 09:37:31.048979+00
160	record.updated	72	148	{"actorUserId": 14}	2026-06-16 09:37:34.747814+00
161	status.changed	72	148	{"to": 50, "from": null, "actorUserId": 14}	2026-06-16 09:37:34.747814+00
162	record.updated	72	148	{"actorUserId": 14}	2026-06-16 09:37:37.349622+00
163	status.changed	72	148	{"to": 51, "from": 50, "actorUserId": 14}	2026-06-16 09:37:37.349622+00
164	record.updated	72	148	{"actorUserId": 14}	2026-06-16 09:37:39.719285+00
165	status.changed	72	148	{"to": 52, "from": 51, "actorUserId": 14}	2026-06-16 09:37:39.719285+00
166	record.updated	72	148	{"actorUserId": 14}	2026-06-16 09:37:41.583248+00
167	status.changed	72	148	{"to": 50, "from": 52, "actorUserId": 14}	2026-06-16 09:37:41.583248+00
168	record.updated	72	148	{"actorUserId": 1}	2026-06-16 09:38:56.327677+00
169	status.changed	72	148	{"to": 51, "from": 50, "actorUserId": 1}	2026-06-16 09:38:56.327677+00
170	record.updated	72	148	{"actorUserId": 1}	2026-06-16 09:39:00.843971+00
171	status.changed	72	148	{"to": 50, "from": 51, "actorUserId": 1}	2026-06-16 09:39:00.843971+00
172	record.updated	72	148	{"actorUserId": 1}	2026-06-17 10:48:10.090093+00
173	status.changed	72	148	{"to": 51, "from": 50, "actorUserId": 1}	2026-06-17 10:48:10.090093+00
174	record.updated	72	148	{"actorUserId": 1}	2026-06-17 10:48:22.876044+00
175	record.deleted	73	145	{"actorUserId": 1}	2026-06-19 09:11:08.301189+00
176	record.updated	74	146	{"actorUserId": 1, "changedFields": ["painter"]}	2026-06-19 12:14:09.042227+00
177	record.updated	74	146	{"actorUserId": 1, "changedFields": ["painter"]}	2026-06-19 15:04:19.811222+00
178	record.updated	72	148	{"actorUserId": 1, "changedFields": ["paint_status"]}	2026-06-19 15:04:19.85235+00
179	record.updated	72	148	{"actorUserId": 1, "changedFields": ["paint_status"]}	2026-06-19 15:04:30.077341+00
180	record.created	72	150	{"statusId": 50, "actorUserId": 1}	2026-06-21 20:06:08.858394+00
181	record.updated	72	150	{"actorUserId": 1, "changedFields": ["mnf_cost_unit"]}	2026-06-21 20:11:10.859007+00
182	record.created	72	151	{"statusId": 50, "actorUserId": 1}	2026-06-21 20:59:06.95005+00
183	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 11:24:49.373606+00
184	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 11:24:54.103801+00
185	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 11:24:57.077709+00
186	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 11:25:41.917693+00
187	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 11:25:44.108272+00
188	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 11:25:46.202017+00
189	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 11:25:48.31028+00
190	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 11:25:50.405114+00
191	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 11:25:52.813816+00
192	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 11:25:54.824874+00
193	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 11:25:56.983633+00
194	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 11:25:58.921333+00
195	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 11:26:02.266019+00
196	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 11:26:04.296694+00
197	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 11:26:06.518701+00
198	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 13:39:24.097287+00
199	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 13:39:28.766364+00
200	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 13:40:18.747255+00
201	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 13:40:20.607938+00
202	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 13:40:22.680613+00
203	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 13:40:25.217809+00
204	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 13:40:27.942041+00
205	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 13:40:54.774558+00
206	record.updated	72	150	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 13:41:03.015509+00
207	record.updated	72	150	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 13:41:06.341463+00
208	record.updated	72	150	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 13:41:08.283397+00
209	record.updated	72	150	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 13:41:10.063682+00
210	record.updated	72	148	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-22 13:41:13.186873+00
211	record.updated	72	151	{"actorUserId": 1, "changedFields": ["comments"]}	2026-06-22 17:02:24.111777+00
212	record.updated	72	148	{"actorUserId": 1, "changedFields": ["comments"]}	2026-06-22 17:02:28.338708+00
213	record.updated	72	150	{"actorUserId": 1, "changedFields": ["comments"]}	2026-06-22 17:02:31.617191+00
214	record.updated	72	150	{"actorUserId": 1, "changedFields": ["comments"]}	2026-06-22 17:02:34.568049+00
215	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_finish_date"]}	2026-06-22 17:02:45.820922+00
216	record.updated	72	151	{"actorUserId": 1, "changedFields": ["material_release_date"]}	2026-06-22 17:03:01.61357+00
217	record.updated	72	151	{"actorUserId": 1, "changedFields": ["paint_status"]}	2026-06-22 17:03:20.749178+00
218	record.updated	72	150	{"actorUserId": 1, "changedFields": ["paint_status"]}	2026-06-22 17:03:26.188501+00
219	record.updated	72	148	{"actorUserId": 1, "changedFields": ["paint_status"]}	2026-06-22 17:03:29.8346+00
220	record.updated	72	150	{"actorUserId": 1, "changedFields": ["paint_finish_date"]}	2026-06-22 17:03:41.278975+00
221	record.updated	72	148	{"actorUserId": 1, "changedFields": ["paint_finish_date"]}	2026-06-22 17:03:48.046433+00
222	record.updated	72	151	{"actorUserId": 1, "changedFields": ["comments"]}	2026-06-23 06:36:24.763186+00
223	record.updated	72	151	{"actorUserId": 1, "changedFields": ["comments"]}	2026-06-23 06:36:27.687183+00
224	record.updated	72	151	{"actorUserId": 1, "changedFields": ["comments"]}	2026-06-23 06:53:27.172113+00
225	record.updated	72	151	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-23 06:56:15.5131+00
226	record.updated	72	148	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-06-23 14:23:29.504051+00
227	record.updated	72	148	{"actorUserId": 1, "changedFields": ["comments"]}	2026-06-23 14:23:32.065726+00
228	user.created	\N	43	{"roleId": 11, "userId": 43, "actorUserId": 1}	2026-06-30 14:22:37.434672+00
229	record.created	73	152	{"statusId": null, "actorUserId": 1}	2026-06-30 14:23:01.069501+00
230	record.updated	74	146	{"actorUserId": 1, "changedFields": ["painter"]}	2026-06-30 15:27:05.044901+00
231	record.updated	72	151	{"actorUserId": 1, "changedFields": ["driver"]}	2026-06-30 15:27:05.098095+00
232	record.updated	72	148	{"actorUserId": 1, "changedFields": ["driver"]}	2026-06-30 15:27:05.114468+00
233	record.updated	72	150	{"actorUserId": 1, "changedFields": ["driver"]}	2026-06-30 15:27:05.132508+00
234	record.updated	74	146	{"actorUserId": 1, "changedFields": ["painter"]}	2026-06-30 15:27:11.501399+00
235	record.updated	72	151	{"actorUserId": 1, "changedFields": ["driver"]}	2026-06-30 15:27:11.552219+00
236	record.updated	72	148	{"actorUserId": 1, "changedFields": ["driver"]}	2026-06-30 15:27:11.629462+00
237	record.updated	72	150	{"actorUserId": 1, "changedFields": ["driver"]}	2026-06-30 15:27:11.650716+00
238	record.updated	74	146	{"actorUserId": 1, "changedFields": ["painter"]}	2026-06-30 15:28:24.403938+00
239	record.updated	72	151	{"actorUserId": 1, "changedFields": ["driver"]}	2026-06-30 15:28:24.441948+00
240	record.updated	72	148	{"actorUserId": 1, "changedFields": ["driver"]}	2026-06-30 15:28:24.45549+00
241	record.updated	72	150	{"actorUserId": 1, "changedFields": ["driver"]}	2026-06-30 15:28:24.476374+00
242	record.updated	74	146	{"actorUserId": 1, "changedFields": ["painter"]}	2026-06-30 15:28:26.054978+00
243	record.updated	72	151	{"actorUserId": 1, "changedFields": ["driver"]}	2026-06-30 15:28:26.096052+00
244	record.updated	72	148	{"actorUserId": 1, "changedFields": ["driver"]}	2026-06-30 15:28:26.111275+00
245	record.updated	72	150	{"actorUserId": 1, "changedFields": ["driver"]}	2026-06-30 15:28:26.12463+00
246	record.created	75	153	{"statusId": null, "actorUserId": 1}	2026-06-30 20:22:27.575205+00
247	record.deleted	75	153	{"actorUserId": 1}	2026-06-30 20:22:32.306488+00
248	record.created	75	154	{"statusId": null, "actorUserId": 1}	2026-06-30 20:35:55.853113+00
249	record.updated	75	154	{"actorUserId": 1, "changedFields": []}	2026-06-30 20:36:33.658445+00
250	record.updated	75	154	{"actorUserId": 1, "changedFields": []}	2026-06-30 20:36:36.013094+00
251	status.changed	75	154	{"to": 58, "from": null, "actorUserId": 1}	2026-06-30 20:36:36.013094+00
252	record.updated	75	154	{"actorUserId": 1, "changedFields": ["direction"]}	2026-06-30 20:57:12.181268+00
253	record.updated	75	154	{"actorUserId": 1, "changedFields": ["direction"]}	2026-06-30 20:57:14.123107+00
254	record.updated	75	154	{"actorUserId": 1, "changedFields": ["direction"]}	2026-06-30 20:57:16.1356+00
255	record.deleted	75	154	{"actorUserId": 1}	2026-07-01 09:01:10.234235+00
256	record.created	75	155	{"statusId": 58, "actorUserId": 1}	2026-07-01 09:01:29.395702+00
257	record.updated	75	155	{"actorUserId": 1, "changedFields": ["driver"]}	2026-07-01 13:03:42.095033+00
258	record.updated	75	155	{"actorUserId": 1, "changedFields": ["driver"]}	2026-07-01 13:03:44.209648+00
259	record.updated	75	155	{"actorUserId": 1, "changedFields": ["driver"]}	2026-07-01 13:03:50.886748+00
260	record.updated	75	155	{"actorUserId": 1, "changedFields": ["driver"]}	2026-07-01 13:04:00.702136+00
261	record.updated	75	155	{"actorUserId": 1, "changedFields": []}	2026-07-01 13:05:46.249378+00
262	status.changed	75	155	{"to": 59, "from": 58, "actorUserId": 1}	2026-07-01 13:05:46.249378+00
263	record.updated	75	155	{"actorUserId": 1, "changedFields": []}	2026-07-01 13:05:48.386193+00
264	status.changed	75	155	{"to": 60, "from": 59, "actorUserId": 1}	2026-07-01 13:05:48.386193+00
265	record.updated	75	155	{"actorUserId": 1, "changedFields": []}	2026-07-01 13:05:50.549959+00
266	status.changed	75	155	{"to": 58, "from": 60, "actorUserId": 1}	2026-07-01 13:05:50.549959+00
267	record.updated	75	155	{"actorUserId": 1, "changedFields": []}	2026-07-01 13:10:05.21506+00
268	status.changed	75	155	{"to": 59, "from": 58, "actorUserId": 1}	2026-07-01 13:10:05.21506+00
269	record.updated	75	155	{"actorUserId": 1, "changedFields": []}	2026-07-01 13:10:10.724582+00
270	status.changed	75	155	{"to": 60, "from": 59, "actorUserId": 1}	2026-07-01 13:10:10.724582+00
271	record.updated	75	155	{"actorUserId": 1, "changedFields": []}	2026-07-01 13:10:22.596788+00
272	status.changed	75	155	{"to": 58, "from": 60, "actorUserId": 1}	2026-07-01 13:10:22.596788+00
273	record.updated	75	155	{"actorUserId": 1, "changedFields": []}	2026-07-01 13:10:24.00111+00
274	status.changed	75	155	{"to": null, "from": 58, "actorUserId": 1}	2026-07-01 13:10:24.00111+00
275	record.updated	75	155	{"actorUserId": 1, "changedFields": []}	2026-07-01 13:10:25.997661+00
276	status.changed	75	155	{"to": 58, "from": null, "actorUserId": 1}	2026-07-01 13:10:25.997661+00
277	record.created	76	156	{"statusId": 61, "actorUserId": 1}	2026-07-01 15:28:08.83559+00
278	user.created	\N	44	{"roleId": 14, "userId": 44, "actorUserId": 1}	2026-07-02 14:29:44.685829+00
279	record.updated	72	151	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:48:10.019675+00
280	record.updated	72	151	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:55:55.46452+00
281	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:55:55.593894+00
282	record.updated	72	148	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:55:55.670896+00
283	record.updated	72	150	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:55:55.692499+00
284	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:55:55.72094+00
285	record.updated	72	148	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:55:55.743415+00
286	record.updated	72	148	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:55:55.749181+00
287	record.updated	72	150	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:55:55.754497+00
288	record.updated	72	150	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:55:55.760722+00
289	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:55:55.772187+00
290	record.updated	72	151	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:55:58.093565+00
291	record.updated	72	148	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:55:58.136536+00
292	record.updated	72	150	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:55:58.154137+00
293	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:55:58.171153+00
294	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:55:58.193544+00
295	record.updated	72	148	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:55:58.205728+00
296	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:55:58.215981+00
297	record.updated	72	150	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:55:58.218176+00
298	record.updated	72	148	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:55:58.229452+00
299	record.updated	72	150	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:55:58.237806+00
300	record.updated	72	151	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:56:01.636873+00
301	record.updated	72	148	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:56:01.67221+00
302	record.updated	72	150	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:56:01.687509+00
303	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:01.703627+00
304	record.updated	72	148	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:01.723128+00
305	record.updated	72	150	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:01.739423+00
306	record.updated	72	148	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:01.740696+00
307	record.updated	72	150	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:01.753885+00
308	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:01.755928+00
309	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:01.764854+00
310	record.updated	72	151	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:56:03.820543+00
311	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:03.856005+00
312	record.updated	72	148	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:56:03.867757+00
313	record.updated	72	150	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:56:03.883048+00
314	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:03.916871+00
315	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:03.931578+00
316	record.updated	72	148	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:03.932819+00
317	record.updated	72	148	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:03.944155+00
318	record.updated	72	150	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:03.945965+00
319	record.updated	72	150	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:03.956069+00
320	record.updated	72	151	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:56:06.367202+00
321	record.updated	72	150	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:56:06.401796+00
322	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:06.41273+00
323	record.updated	72	148	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:56:06.428182+00
324	record.updated	72	150	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:06.447189+00
325	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:06.457847+00
326	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:06.469263+00
327	record.updated	72	148	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:06.471865+00
328	record.updated	72	148	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:06.480366+00
329	record.updated	72	150	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:06.487942+00
330	record.updated	72	151	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:56:16.491177+00
331	record.updated	72	148	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:56:16.538692+00
332	record.updated	72	150	{"actorUserId": 1, "changedFields": ["installation_team"]}	2026-07-02 18:56:16.559591+00
333	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:16.578135+00
334	record.updated	72	148	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:16.626375+00
335	record.updated	72	150	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:16.646017+00
336	record.updated	72	148	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:16.653674+00
337	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:16.665424+00
338	record.updated	72	150	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:16.673649+00
339	record.updated	72	151	{"actorUserId": 1, "changedFields": []}	2026-07-02 18:56:16.70075+00
340	record.updated	72	151	{"actorUserId": null, "changedFields": ["item_name"]}	2026-07-02 19:27:33.166068+00
341	record.updated	72	148	{"actorUserId": 1, "changedFields": []}	2026-07-02 19:38:55.119056+00
342	status.changed	72	148	{"to": 50, "from": 51, "actorUserId": 1}	2026-07-02 19:38:55.119056+00
343	record.created	74	157	{"statusId": null, "actorUserId": 1}	2026-07-05 19:55:57.389728+00
344	record.created	72	158	{"statusId": 50, "actorUserId": 1}	2026-07-05 19:56:08.146666+00
345	record.updated	72	158	{"actorUserId": 1, "changedFields": ["quantity"]}	2026-07-05 19:56:49.2594+00
346	record.updated	72	158	{"actorUserId": 1, "changedFields": ["unit_price"]}	2026-07-05 19:57:03.548524+00
347	record.updated	72	158	{"actorUserId": 1, "changedFields": ["mnf_cost_unit"]}	2026-07-05 19:57:23.908406+00
348	record.updated	72	158	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-07-05 19:57:53.242072+00
349	record.updated	72	158	{"actorUserId": 1, "changedFields": ["comments"]}	2026-07-05 19:57:55.715078+00
350	record.updated	72	158	{"actorUserId": 1, "changedFields": ["production_finish_date"]}	2026-07-05 19:58:03.25325+00
351	record.updated	72	158	{"actorUserId": 1, "changedFields": ["material_release_date"]}	2026-07-05 19:58:14.115198+00
352	record.updated	72	158	{"actorUserId": 1, "changedFields": ["paint_status"]}	2026-07-05 19:58:17.210263+00
353	record.updated	72	158	{"actorUserId": 1, "changedFields": ["paint_finish_date"]}	2026-07-05 19:58:24.558815+00
354	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 06:39:44.064858+00
355	record.updated	76	156	{"actorUserId": 1, "changedFields": []}	2026-07-06 06:39:44.111432+00
356	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 06:39:47.217821+00
357	record.updated	76	156	{"actorUserId": 1, "changedFields": ["payment_type"]}	2026-07-06 06:39:47.292581+00
358	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 06:39:57.275897+00
359	record.updated	76	156	{"actorUserId": 1, "changedFields": ["payment_type"]}	2026-07-06 06:39:57.315664+00
360	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 06:40:15.966351+00
361	record.updated	76	156	{"actorUserId": 1, "changedFields": ["payment_type"]}	2026-07-06 06:40:16.002388+00
362	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 06:43:58.470923+00
363	record.updated	76	156	{"actorUserId": 1, "changedFields": ["payment_type"]}	2026-07-06 06:43:58.593891+00
364	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 06:44:01.006102+00
365	record.updated	76	156	{"actorUserId": 1, "changedFields": ["payment_type"]}	2026-07-06 06:44:01.045499+00
366	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 06:44:06.89008+00
367	record.updated	76	156	{"actorUserId": 1, "changedFields": ["payment_type"]}	2026-07-06 06:44:06.923475+00
368	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 06:44:09.59216+00
369	record.updated	76	156	{"actorUserId": 1, "changedFields": ["payment_type"]}	2026-07-06 06:44:09.622703+00
370	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 06:44:11.653033+00
371	record.updated	76	156	{"actorUserId": 1, "changedFields": ["payment_type"]}	2026-07-06 06:44:11.689508+00
372	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["dni_chasy"]}	2026-07-06 06:44:41.910783+00
373	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 06:44:49.075438+00
374	record.updated	76	156	{"actorUserId": 1, "changedFields": ["payment_type"]}	2026-07-06 06:44:49.112056+00
375	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["dni_chasy"]}	2026-07-06 06:44:55.974391+00
376	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 06:44:58.63631+00
377	record.updated	76	156	{"actorUserId": 1, "changedFields": ["payment_type"]}	2026-07-06 06:44:58.672054+00
378	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:08:08.557375+00
379	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:08:10.817236+00
380	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:08:19.460797+00
381	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:08:21.640957+00
382	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:10:59.211555+00
383	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:11:00.711028+00
384	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:11:55.218527+00
385	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:11:57.14243+00
386	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:11:59.845988+00
387	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:12:01.556805+00
388	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:14:53.496985+00
389	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:14:55.849361+00
390	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:14:57.812514+00
391	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 07:17:15.77034+00
392	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 07:17:20.999597+00
393	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["stavka"]}	2026-07-06 07:18:16.485684+00
394	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["stavka"]}	2026-07-06 07:18:33.517187+00
395	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 07:19:51.854476+00
396	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 07:19:54.401832+00
397	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:19:57.138316+00
398	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:19:59.179937+00
399	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:23:25.367724+00
400	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:23:25.434642+00
401	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:23:25.449683+00
402	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:23:27.669709+00
403	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:23:27.728711+00
404	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:23:27.738956+00
405	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 07:23:30.45654+00
406	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 07:23:30.553653+00
407	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 07:23:30.56557+00
408	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 07:23:33.427588+00
409	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 07:23:33.479316+00
410	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 07:23:33.499279+00
411	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:23:37.466411+00
412	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:23:37.52418+00
413	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:23:37.545186+00
414	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:23:40.957084+00
415	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:23:41.008516+00
416	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 07:23:41.020634+00
417	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["dni_chasy", "stavka"]}	2026-07-06 08:03:58.706755+00
418	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["vypolneniya"]}	2026-07-06 08:04:24.421707+00
419	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["dni_chasy", "stavka"]}	2026-07-06 08:04:28.80512+00
420	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["vypolneniya"]}	2026-07-06 08:04:32.158642+00
421	page_field.saved	72	158	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["dni_chasy", "stavka", "tip_oplaty"]}	2026-07-06 08:04:46.939009+00
422	page_field.saved	72	158	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["vypolneniya"]}	2026-07-06 08:04:50.837041+00
423	page_field.saved	72	158	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["oplacheno"]}	2026-07-06 08:05:09.05424+00
424	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["oplacheno"]}	2026-07-06 08:05:21.072571+00
425	page_field.saved	72	158	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 08:10:11.348756+00
426	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 08:11:20.83258+00
427	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 08:11:20.874891+00
428	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 08:11:20.886337+00
429	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["vypolneniya"]}	2026-07-06 09:43:33.482145+00
430	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 09:58:11.677452+00
431	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 09:58:11.749801+00
432	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 09:58:11.769415+00
433	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 09:58:21.999394+00
434	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 09:58:22.044977+00
435	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 09:58:22.059143+00
436	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:32.380148+00
437	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:32.437797+00
438	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:32.446971+00
439	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:36.42792+00
440	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:36.476106+00
441	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:36.486966+00
442	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:44.911856+00
443	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:44.965028+00
444	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:44.975688+00
445	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:46.801685+00
446	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:46.851986+00
447	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:46.862029+00
448	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:51.03098+00
449	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:51.075947+00
450	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:51.085253+00
451	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:55.580114+00
452	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:55.624653+00
453	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:04:55.641094+00
454	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:06:50.566887+00
455	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:06:50.617734+00
456	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:06:50.627629+00
457	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:06:54.346609+00
458	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:06:54.393331+00
459	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:06:54.402467+00
460	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:07:00.776499+00
461	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:07:00.817811+00
462	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:07:00.829374+00
463	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:07:03.862322+00
464	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:07:03.928604+00
465	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:07:03.947271+00
466	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:26:48.304961+00
467	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:26:48.470201+00
468	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:26:48.478681+00
469	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:26:51.171281+00
470	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:26:51.212728+00
471	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 10:26:51.222134+00
472	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["vypolneniya"]}	2026-07-06 19:27:08.21172+00
473	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["vypolneniya"]}	2026-07-06 19:27:16.362941+00
474	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["vypolneniya"]}	2026-07-06 19:27:20.468412+00
475	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 19:27:31.539875+00
476	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 19:27:31.59005+00
477	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 19:27:31.607378+00
478	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 19:27:38.67793+00
479	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 19:27:38.717892+00
480	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 19:27:38.727983+00
481	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["dni_chasy"]}	2026-07-06 19:28:17.685029+00
482	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["stavka"]}	2026-07-06 19:28:24.707213+00
483	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 19:28:33.835544+00
484	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 19:28:33.883028+00
485	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 19:28:33.892972+00
486	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["stavka"]}	2026-07-06 19:28:41.617348+00
487	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["dni_chasy"]}	2026-07-06 19:28:43.703175+00
488	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["vypolneniya"]}	2026-07-06 19:28:47.310724+00
489	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 19:29:52.833476+00
490	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 19:29:52.881988+00
491	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["installation_team"]}	2026-07-06 19:29:52.900702+00
492	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 19:31:48.709502+00
493	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 19:31:48.756205+00
494	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["tip_oplaty"]}	2026-07-06 19:31:48.775932+00
495	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["vypolneniya"]}	2026-07-06 19:31:53.064574+00
496	user.created	\N	45	{"roleId": 11, "userId": 45, "actorUserId": 1}	2026-07-06 19:37:24.196142+00
497	record.created	73	159	{"statusId": null, "actorUserId": 1}	2026-07-06 19:38:06.794953+00
498	record.created	74	160	{"statusId": null, "actorUserId": 1}	2026-07-06 19:40:08.660469+00
499	record.created	72	161	{"statusId": 50, "actorUserId": 1}	2026-07-06 19:46:04.429618+00
500	record.updated	72	161	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-07-06 19:53:31.471412+00
501	record.updated	72	161	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-07-06 19:55:23.100108+00
502	record.updated	72	161	{"actorUserId": 14, "changedFields": ["production_status"]}	2026-07-06 20:00:10.575845+00
503	record.updated	72	161	{"actorUserId": 14, "changedFields": ["production_status"]}	2026-07-06 20:00:13.6655+00
504	record.updated	72	161	{"actorUserId": 14, "changedFields": ["production_finish_date"]}	2026-07-06 20:06:39.344469+00
505	record.updated	72	161	{"actorUserId": 1, "changedFields": ["comments"]}	2026-07-06 20:08:04.740595+00
506	record.updated	72	161	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-07-06 20:08:23.555083+00
507	record.updated	72	161	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-07-06 20:10:20.445927+00
508	record.updated	72	161	{"actorUserId": 1, "changedFields": ["production_status"]}	2026-07-06 20:10:25.687221+00
509	record.updated	72	161	{"actorUserId": 1, "changedFields": ["comments"]}	2026-07-06 20:12:33.885045+00
510	record.created	75	162	{"statusId": 59, "actorUserId": 1}	2026-07-06 20:15:05.792074+00
511	record.created	75	163	{"statusId": 59, "actorUserId": 1}	2026-07-06 20:17:18.902347+00
512	record.updated	75	163	{"actorUserId": 1, "changedFields": []}	2026-07-06 20:21:59.832422+00
513	status.changed	75	163	{"to": 60, "from": 59, "actorUserId": 1}	2026-07-06 20:21:59.832422+00
514	record.updated	75	162	{"actorUserId": 1, "changedFields": []}	2026-07-06 20:22:01.372542+00
515	status.changed	75	162	{"to": 60, "from": 59, "actorUserId": 1}	2026-07-06 20:22:01.372542+00
516	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["data_nachala_rabot"]}	2026-07-07 07:03:51.450517+00
517	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["data_nachala_rabot"]}	2026-07-07 07:03:51.832972+00
518	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["data_nachala_rabot"]}	2026-07-07 07:03:51.848851+00
519	page_field.saved	72	151	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["data_okonchaniya_rabot"]}	2026-07-07 07:03:58.611849+00
520	page_field.saved	72	148	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["data_okonchaniya_rabot"]}	2026-07-07 07:03:58.656667+00
521	page_field.saved	72	150	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["data_okonchaniya_rabot"]}	2026-07-07 07:03:58.668036+00
522	page_field.saved	72	158	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["data_nachala_rabot"]}	2026-07-07 07:04:11.255905+00
523	page_field.saved	72	158	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["data_okonchaniya_rabot"]}	2026-07-07 07:04:14.757059+00
524	page_field.saved	72	158	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["data_nachala_rabot"]}	2026-07-07 07:04:47.381846+00
525	page_field.saved	72	158	{"pageId": 81, "actorUserId": 1, "changedPageFieldKeys": ["data_okonchaniya_rabot"]}	2026-07-07 07:04:56.285516+00
\.


--
-- Data for Name: translations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.translations (id, translation_key, translations_json, created_at, updated_at) FROM stdin;
1	app.title	{"en": "ERP Builder", "he": "בונה ERP", "ru": "ERP Конструктор"}	2026-06-04 18:00:55.112725+00	2026-06-04 18:00:55.112725+00
2	nav.dashboard	{"en": "Dashboard", "he": "לוח בקרה", "ru": "Панель управления"}	2026-06-04 18:00:55.112725+00	2026-06-04 18:00:55.112725+00
3	nav.admin	{"en": "Administration", "he": "ניהול", "ru": "Администрирование"}	2026-06-04 18:00:55.112725+00	2026-06-04 18:00:55.112725+00
4	nav.users	{"en": "Users", "he": "משתמשים", "ru": "Пользователи"}	2026-06-04 18:00:55.112725+00	2026-06-04 18:00:55.112725+00
5	nav.roles	{"en": "Roles", "he": "תפקידים", "ru": "Роли"}	2026-06-04 18:00:55.112725+00	2026-06-04 18:00:55.112725+00
6	nav.pages	{"en": "Pages", "he": "דפים", "ru": "Страницы"}	2026-06-04 18:00:55.112725+00	2026-06-04 18:00:55.112725+00
7	nav.translations	{"en": "Translations", "he": "תרגומים", "ru": "Переводы"}	2026-06-04 18:00:55.112725+00	2026-06-04 18:00:55.112725+00
8	auth.login	{"en": "Login", "he": "כניסה", "ru": "Войти"}	2026-06-04 18:00:55.112725+00	2026-06-04 18:00:55.112725+00
9	auth.logout	{"en": "Logout", "he": "יציאה", "ru": "Выйти"}	2026-06-04 18:00:55.112725+00	2026-06-04 18:00:55.112725+00
13	common.edit	{"en": "Edit", "he": "ערוך", "ru": "Редактировать"}	2026-06-04 18:00:55.112725+00	2026-06-04 18:00:55.112725+00
15	common.search	{"en": "Search", "he": "חיפוש", "ru": "Поиск"}	2026-06-04 18:00:55.112725+00	2026-06-04 18:00:55.112725+00
28	page.emptyTitle	{"en": "Page created but not filled in", "he": "הדף נוצר אך אינו מאוכלס", "ru": "Страница создана, но не наполнена"}	2026-06-05 11:02:47.17058+00	2026-07-07 14:01:00.153+00
25	login.submit	{"en": "Sign in", "he": "כניסה", "ru": "Войти"}	2026-06-05 11:02:47.162686+00	2026-07-07 14:00:59.911+00
20	login.errorDesc	{"en": "Invalid email or password", "he": "אימייל או סיסמה שגויים", "ru": "Неверный email или пароль"}	2026-06-05 11:02:47.148443+00	2026-07-07 14:00:59.901+00
24	login.loggingIn	{"en": "Signing in...", "he": "מתחבר...", "ru": "Вход..."}	2026-06-05 11:02:47.1595+00	2026-07-07 14:00:59.904+00
32	dashboard.evening	{"en": "Good evening", "he": "ערב טוב", "ru": "Добрый вечер"}	2026-06-05 11:02:47.180802+00	2026-07-07 14:00:57.954+00
35	dashboard.pages	{"en": "Pages", "he": "דפים", "ru": "Страницы"}	2026-06-05 11:02:47.18782+00	2026-07-07 14:00:57.961+00
39	dashboard.recentLogins	{"en": "Recent logins", "he": "כניסות אחרונות", "ru": "Недавних входов"}	2026-06-05 11:02:47.196871+00	2026-07-07 14:00:57.966+00
36	dashboard.systemActivity	{"en": "System activity", "he": "פעילות המערכת", "ru": "Активность системы"}	2026-06-05 11:02:47.190011+00	2026-07-07 14:00:57.972+00
33	dashboard.users	{"en": "Users", "he": "משתמשים", "ru": "Пользователи"}	2026-06-05 11:02:47.183879+00	2026-07-07 14:00:57.977+00
47	records.entityRecords	{"en": "Entity records", "he": "רשומות הישות", "ru": "Записи сущности"}	2026-06-05 11:02:47.214815+00	2026-07-07 14:01:00.663+00
14	common.create	{"en": "Create", "he": "צור", "ru": "Создать"}	2026-06-04 18:00:55.112725+00	2026-07-07 14:01:03.001+00
12	common.delete	{"en": "Delete", "he": "מחיקה", "ru": "Удалить"}	2026-06-04 18:00:55.112725+00	2026-07-07 14:00:57.187+00
37	dashboard.activeUsers	{"en": "Active users", "he": "משתמשים פעילים", "ru": "Активных пользователей"}	2026-06-05 11:02:47.192737+00	2026-07-07 14:00:57.803+00
43	dashboard.dbActive	{"en": "Active", "he": "פעיל", "ru": "Активна"}	2026-06-05 11:02:47.205783+00	2026-07-07 14:00:57.949+00
18	layout.logout	{"en": "Log out", "he": "התנתקות", "ru": "Выйти"}	2026-06-05 11:02:47.143259+00	2026-07-07 14:00:59.886+00
26	page.accessDenied	{"en": "Access denied", "he": "הגישה נדחתה", "ru": "Доступ запрещён"}	2026-06-05 11:02:47.165681+00	2026-07-07 14:01:00.142+00
48	pages.created	{"en": "Page created", "he": "הדף נוצר", "ru": "Страница создана"}	2026-06-05 11:02:47.216759+00	2026-07-07 14:01:00.246+00
31	dashboard.afternoon	{"en": "Good afternoon", "he": "צהריים טובים", "ru": "Добрый день"}	2026-06-05 11:02:47.17846+00	2026-07-07 14:00:57.938+00
38	dashboard.blockedUsers	{"en": "Blocked users", "he": "משתמשים חסומים", "ru": "Заблокированных пользователей"}	2026-06-05 11:02:47.194509+00	2026-07-07 14:00:57.945+00
23	login.password	{"en": "Password", "he": "סיסמה", "ru": "Пароль"}	2026-06-05 11:02:47.156549+00	2026-07-07 14:00:59.909+00
27	page.accessDeniedDesc	{"en": "You do not have permission to view this page. Contact your administrator.", "he": "אין לך הרשאה לצפות בדף זה. פנה למנהל המערכת.", "ru": "У вас нет прав для просмотра этой страницы. Обратитесь к администратору."}	2026-06-05 11:02:47.168445+00	2026-07-07 14:01:00.146+00
42	dashboard.dbStatus	{"en": "Database status", "he": "סטטוס מסד הנתונים", "ru": "Статус базы данных"}	2026-06-05 11:02:47.202832+00	2026-07-07 14:00:57.952+00
30	dashboard.morning	{"en": "Good morning", "he": "בוקר טוב", "ru": "Доброе утро"}	2026-06-05 11:02:47.175974+00	2026-07-07 14:00:57.957+00
41	dashboard.platformVersion	{"en": "Platform version", "he": "גרסת הפלטפורמה", "ru": "Версия платформы"}	2026-06-05 11:02:47.201115+00	2026-07-07 14:00:57.963+00
45	records.backToEntities	{"en": "Back to entities", "he": "חזרה לישויות", "ru": "К списку сущностей"}	2026-06-05 11:02:47.210551+00	2026-07-07 14:01:00.498+00
11	common.cancel	{"en": "Cancel", "he": "ביטול", "ru": "Отмена"}	2026-06-04 18:00:55.112725+00	2026-07-07 14:00:56.781+00
46	records.title	{"en": "Data", "he": "נתונים", "ru": "Данные"}	2026-06-05 11:02:47.212462+00	2026-07-07 14:01:01.114+00
34	dashboard.roles	{"en": "Roles", "he": "תפקידים", "ru": "Роли"}	2026-06-05 11:02:47.185665+00	2026-07-07 14:00:57.969+00
44	dashboard.yourRole	{"en": "Your role", "he": "התפקיד שלך", "ru": "Ваша роль"}	2026-06-05 11:02:47.208111+00	2026-07-07 14:00:57.98+00
17	layout.settings	{"en": "Settings", "he": "הגדרות", "ru": "Настройки"}	2026-06-05 11:02:47.131615+00	2026-07-07 14:00:59.89+00
21	login.title	{"en": "Sign in", "he": "כניסה למערכת", "ru": "Вход в систему"}	2026-06-05 11:02:47.151627+00	2026-07-07 14:00:59.919+00
10	common.save	{"en": "Save", "he": "שמירה", "ru": "Сохранить"}	2026-06-04 18:00:55.112725+00	2026-07-07 14:00:57.194+00
40	dashboard.systemInfo	{"en": "System information", "he": "מידע על המערכת", "ru": "Информация о системе"}	2026-06-05 11:02:47.199234+00	2026-07-07 14:00:57.974+00
62	pages.colActions	{"en": "Actions", "he": "פעולות", "ru": "Действия"}	2026-06-05 11:02:47.248407+00	2026-07-07 14:01:00.225+00
56	pages.create	{"en": "Create page", "he": "צור דף", "ru": "Создать страницу"}	2026-06-05 11:02:47.234151+00	2026-07-07 14:01:00.243+00
76	pages.createShort	{"en": "Create", "he": "צור", "ru": "Создать"}	2026-06-05 11:02:47.276707+00	2026-07-07 14:01:00.253+00
79	pages.delete	{"en": "Delete", "he": "מחיקה", "ru": "Удалить"}	2026-06-05 11:02:47.283168+00	2026-07-07 14:01:00.261+00
78	pages.deleteConfirm	{"en": "will be permanently deleted.", "he": "יימחק לצמיתות.", "ru": "будет удалена безвозвратно."}	2026-06-05 11:02:47.281345+00	2026-07-07 14:01:00.268+00
51	pages.deleted	{"en": "Page deleted", "he": "הדף נמחק", "ru": "Страница удалена"}	2026-06-05 11:02:47.22375+00	2026-07-07 14:01:00.272+00
70	pages.parent	{"en": "Parent page", "he": "דף אב", "ru": "Родительская страница"}	2026-06-05 11:02:47.264264+00	2026-07-07 14:01:00.336+00
74	pages.cancel	{"en": "Cancel", "he": "ביטול", "ru": "Отмена"}	2026-06-05 11:02:47.272296+00	2026-07-07 14:01:00.221+00
89	statuses.add	{"en": "Add status", "he": "הוסף סטטוס", "ru": "Добавить статус"}	2026-06-05 11:02:47.303813+00	2026-07-07 14:01:01.857+00
84	statuses.deleted	{"en": "Status deleted", "he": "הסטטוס נמחק", "ru": "Статус удалён"}	2026-06-05 11:02:47.293727+00	2026-07-07 14:01:01.934+00
73	pages.activeInMenu	{"en": "Active (visible in menu)", "he": "פעיל (גלוי בתפריט)", "ru": "Активна (видна в меню)"}	2026-06-05 11:02:47.270287+00	2026-07-07 14:01:00.211+00
64	pages.statusHidden	{"en": "Hidden", "he": "מוסתר", "ru": "Скрыта"}	2026-06-05 11:02:47.252566+00	2026-07-07 14:01:00.375+00
92	statuses.colKey	{"en": "Key", "he": "מפתח", "ru": "Ключ"}	2026-06-05 11:02:47.310121+00	2026-07-07 14:01:01.894+00
71	pages.rootPlaceholder	{"en": "Root page", "he": "דף שורש", "ru": "Корневая страница"}	2026-06-05 11:02:47.265957+00	2026-07-07 14:01:00.364+00
72	pages.rootOption	{"en": "— Root —", "he": "— שורש —", "ru": "— Корневая —"}	2026-06-05 11:02:47.267976+00	2026-07-07 14:01:00.361+00
75	pages.save	{"en": "Save", "he": "שמירה", "ru": "Сохранить"}	2026-06-05 11:02:47.274765+00	2026-07-07 14:01:00.367+00
63	pages.statusActive	{"en": "Active", "he": "פעיל", "ru": "Активна"}	2026-06-05 11:02:47.250428+00	2026-07-07 14:01:00.37+00
53	pages.reorderError	{"en": "Error changing order", "he": "שגיאה בשינוי הסדר", "ru": "Ошибка изменения порядка"}	2026-06-05 11:02:47.227392+00	2026-07-07 14:01:00.358+00
82	statuses.updated	{"en": "Status updated", "he": "הסטטוס עודכן", "ru": "Статус обновлён"}	2026-06-05 11:02:47.28959+00	2026-07-07 14:01:01.987+00
83	statuses.updateError	{"en": "Update error", "he": "שגיאת עדכון", "ru": "Ошибка обновления"}	2026-06-05 11:02:47.291797+00	2026-07-07 14:01:01.99+00
93	statuses.colFlags	{"en": "Flags", "he": "מאפיינים", "ru": "Признаки"}	2026-06-05 11:02:47.312644+00	2026-07-07 14:01:01.891+00
91	statuses.colName	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-05 11:02:47.308212+00	2026-07-07 14:01:01.896+00
95	statuses.colActions	{"en": "Actions", "he": "פעולות", "ru": "Действия"}	2026-06-05 11:02:47.316708+00	2026-07-07 14:01:01.888+00
80	statuses.created	{"en": "Status created", "he": "הסטטוס נוצר", "ru": "Статус создан"}	2026-06-05 11:02:47.285574+00	2026-07-07 14:01:01.91+00
81	statuses.createError	{"en": "Error creating status", "he": "שגיאה ביצירת הסטטוס", "ru": "Ошибка создания статуса"}	2026-06-05 11:02:47.287802+00	2026-07-07 14:01:01.912+00
94	statuses.colStatus	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-06-05 11:02:47.314762+00	2026-07-07 14:01:01.903+00
88	statuses.subtitle	{"en": "Record lifecycle of the entity", "he": "מחזור החיים של רשומות הישות", "ru": "Жизненный цикл записей сущности"}	2026-06-05 11:02:47.301457+00	2026-07-07 14:01:01.979+00
85	statuses.deleteError	{"en": "Error deleting status", "he": "שגיאה במחיקת הסטטוס", "ru": "Ошибка удаления статуса"}	2026-06-05 11:02:47.295998+00	2026-07-07 14:01:01.941+00
68	pages.path	{"en": "Path (route)", "he": "נתיב (מסלול)", "ru": "Путь (маршрут)"}	2026-06-05 11:02:47.260367+00	2026-07-07 14:01:00.341+00
69	pages.pathHint	{"en": "Page address in the menu. Leave empty for a section group.", "he": "כתובת הדף בתפריט. השאר ריק עבור קבוצת מקטע.", "ru": "Адрес страницы в меню. Оставьте пустым для группы-раздела."}	2026-06-05 11:02:47.262598+00	2026-07-07 14:01:00.345+00
87	statuses.title	{"en": "Statuses", "he": "סטטוסים", "ru": "Статусы"}	2026-06-05 11:02:47.299624+00	2026-07-07 14:01:01.985+00
55	pages.subtitle	{"en": "Manage navigation and menu items", "he": "ניהול ניווט ופריטי תפריט", "ru": "Управление навигацией и пунктами меню"}	2026-06-05 11:02:47.231575+00	2026-07-07 14:01:00.378+00
86	statuses.backToEntities	{"en": "Back to entities", "he": "חזרה לישויות", "ru": "К списку сущностей"}	2026-06-05 11:02:47.297829+00	2026-07-07 14:01:01.88+00
50	pages.updated	{"en": "Page updated", "he": "הדף עודכן", "ru": "Страница обновлена"}	2026-06-05 11:02:47.221438+00	2026-07-07 14:01:00.451+00
54	pages.title	{"en": "Pages", "he": "דפים", "ru": "Страницы"}	2026-06-05 11:02:47.229763+00	2026-07-07 14:01:00.382+00
77	pages.deleteTitle	{"en": "Delete page?", "he": "למחוק את הדף?", "ru": "Удалить страницу?"}	2026-06-05 11:02:47.279182+00	2026-07-07 14:01:00.276+00
67	pages.description	{"en": "Description", "he": "תיאור", "ru": "Описание"}	2026-06-05 11:02:47.258648+00	2026-07-07 14:01:00.28+00
57	pages.empty	{"en": "No pages found", "he": "לא נמצאו דפים", "ru": "Страницы не найдены"}	2026-06-05 11:02:47.23605+00	2026-07-07 14:01:00.29+00
66	pages.newTitle	{"en": "New page", "he": "דף חדש", "ru": "Новая страница"}	2026-06-05 11:02:47.256899+00	2026-07-07 14:01:00.329+00
65	pages.editTitle	{"en": "Edit page", "he": "עריכת דף", "ru": "Редактировать страницу"}	2026-06-05 11:02:47.254453+00	2026-07-07 14:01:00.287+00
59	pages.colIcon	{"en": "Icon", "he": "סמל", "ru": "Иконка"}	2026-06-05 11:02:47.240307+00	2026-07-07 14:01:00.232+00
58	pages.colName	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-05 11:02:47.238283+00	2026-07-07 14:01:00.234+00
60	pages.colOrder	{"en": "Sorting", "he": "מיון", "ru": "Порядок"}	2026-06-05 11:02:47.24285+00	2026-07-07 14:01:00.238+00
61	pages.colStatus	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-06-05 11:02:47.246101+00	2026-07-07 14:01:00.24+00
113	statuses.archiveImmediate	{"en": "0 — the record is archived immediately upon transition to this status.", "he": "0 — הרשומה מועברת לארכיון מיד עם המעבר לסטטוס זה.", "ru": "0 — запись архивируется сразу при переходе в этот статус."}	2026-06-05 11:02:47.355328+00	2026-07-07 14:01:01.874+00
119	statuses.deleteConfirmTitle	{"en": "Delete status?", "he": "למחוק סטטוס?", "ru": "Удалить статус?"}	2026-06-05 11:02:47.372682+00	2026-07-07 14:01:01.931+00
105	statuses.systemKey	{"en": "System key", "he": "מפתח מערכת", "ru": "Системный ключ"}	2026-06-05 11:02:47.338953+00	2026-07-07 14:01:01.982+00
129	users.title	{"en": "Users", "he": "משתמשים", "ru": "Пользователи"}	2026-06-05 11:02:47.392456+00	2026-07-07 14:01:02.264+00
134	users.colRole	{"en": "Role", "he": "תפקיד", "ru": "Роль"}	2026-06-05 11:02:47.401569+00	2026-07-07 14:01:02.011+00
138	users.empty	{"en": "No users found", "he": "לא נמצאו משתמשים", "ru": "Пользователи не найдены"}	2026-06-05 11:02:47.40927+00	2026-07-07 14:01:02.06+00
126	users.blocked	{"en": "Blocked", "he": "חסום", "ru": "Заблокирован"}	2026-06-05 11:02:47.386763+00	2026-07-07 14:01:01.999+00
127	users.unblocked	{"en": "Unblocked", "he": "שוחרר", "ru": "Разблокирован"}	2026-06-05 11:02:47.388459+00	2026-07-07 14:01:02.266+00
100	statuses.active	{"en": "Active", "he": "פעיל", "ru": "Активно"}	2026-06-05 11:02:47.328723+00	2026-07-07 14:01:01.819+00
115	statuses.archiveDelayedPost	{"en": "d. after transition to this status.", "he": "ימים לאחר המעבר לסטטוס זה.", "ru": "дн. после перехода в этот статус."}	2026-06-05 11:02:47.360003+00	2026-07-07 14:01:01.867+00
124	users.updated	{"en": "User updated", "he": "המשתמש עודכן", "ru": "Пользователь обновлён"}	2026-06-05 11:02:47.38273+00	2026-07-07 14:01:02.273+00
122	users.created	{"en": "User created", "he": "המשתמש נוצר", "ru": "Пользователь создан"}	2026-06-05 11:02:47.379447+00	2026-07-07 14:01:02.033+00
98	statuses.archive	{"en": "Archive", "he": "ארכיון", "ru": "Архив"}	2026-06-05 11:02:47.324725+00	2026-07-07 14:01:01.86+00
123	users.error	{"en": "Error", "he": "שגיאה", "ru": "Ошибка"}	2026-06-05 11:02:47.381104+00	2026-07-07 14:01:02.064+00
133	users.colUser	{"en": "User", "he": "משתמש", "ru": "Пользователь"}	2026-06-05 11:02:47.399966+00	2026-07-07 14:01:02.028+00
136	users.colStatus	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-06-05 11:02:47.405337+00	2026-07-07 14:01:02.025+00
131	users.create	{"en": "Create", "he": "צור", "ru": "Создать"}	2026-06-05 11:02:47.39581+00	2026-07-07 14:01:02.03+00
125	users.deleted	{"en": "User deleted", "he": "המשתמש נמחק", "ru": "Пользователь удалён"}	2026-06-05 11:02:47.385031+00	2026-07-07 14:01:02.045+00
128	users.passwordReset	{"en": "Password reset", "he": "הסיסמה אופסה", "ru": "Пароль сброшен"}	2026-06-05 11:02:47.390291+00	2026-07-07 14:01:02.231+00
132	users.searchPlaceholder	{"en": "Search by name or email...", "he": "חיפוש לפי שם או אימייל...", "ru": "Поиск по имени или email..."}	2026-06-05 11:02:47.397565+00	2026-07-07 14:01:02.251+00
112	statuses.archiveAfterDays	{"en": "Archive after (days)", "he": "העבר לארכיון לאחר (ימים)", "ru": "Архивировать через (дней)"}	2026-06-05 11:02:47.352973+00	2026-07-07 14:01:01.863+00
130	users.subtitle	{"en": "Account management", "he": "ניהול חשבונות", "ru": "Управление учётными записями"}	2026-06-05 11:02:47.394136+00	2026-07-07 14:01:02.261+00
114	statuses.archiveDelayedPre	{"en": "The record will be moved to the archive in", "he": "הרשומה תועבר לארכיון בעוד", "ru": "Запись будет скрыта в архив через"}	2026-06-05 11:02:47.357472+00	2026-07-07 14:01:01.871+00
116	statuses.cancel	{"en": "Cancel", "he": "ביטול", "ru": "Отмена"}	2026-06-05 11:02:47.362786+00	2026-07-07 14:01:01.885+00
108	statuses.color	{"en": "Color", "he": "צבע", "ru": "Цвет"}	2026-06-05 11:02:47.345033+00	2026-07-07 14:01:01.899+00
121	statuses.delete	{"en": "Delete", "he": "מחיקה", "ru": "Удалить"}	2026-06-05 11:02:47.377684+00	2026-07-07 14:01:01.925+00
97	statuses.final	{"en": "Final", "he": "סופי", "ru": "Финальный"}	2026-06-05 11:02:47.322475+00	2026-07-07 14:01:01.951+00
117	statuses.save	{"en": "Save", "he": "שמירה", "ru": "Сохранить"}	2026-06-05 11:02:47.365728+00	2026-07-07 14:01:01.976+00
120	statuses.deleteConfirmDesc	{"en": "will be permanently deleted.", "he": "יימחק לצמיתות.", "ru": "будет удалён безвозвратно."}	2026-06-05 11:02:47.374674+00	2026-07-07 14:01:01.928+00
118	statuses.create	{"en": "Create", "he": "צור", "ru": "Создать"}	2026-06-05 11:02:47.370679+00	2026-07-07 14:01:01.906+00
109	statuses.order	{"en": "Sorting", "he": "מיון", "ru": "Порядок"}	2026-06-05 11:02:47.347484+00	2026-07-07 14:01:01.971+00
101	statuses.hidden	{"en": "Hidden", "he": "מוסתר", "ru": "Скрыто"}	2026-06-05 11:02:47.331175+00	2026-07-07 14:01:01.954+00
103	statuses.newTitle	{"en": "New status", "he": "סטטוס חדש", "ru": "Новый статус"}	2026-06-05 11:02:47.334772+00	2026-07-07 14:01:01.968+00
106	statuses.keyHintPre	{"en": "Lowercase Latin letters, digits and underscores only (e.g.", "he": "אותיות לטיניות קטנות, ספרות וקווים תחתונים בלבד (לדוגמה,", "ru": "Только строчные латинские буквы, цифры и подчёркивания (например,"}	2026-06-05 11:02:47.341203+00	2026-07-07 14:01:01.965+00
110	statuses.defaultHint	{"en": "\\"Default\\" is assigned to new records. An entity can have only one default status.", "he": "\\"ברירת מחדל\\" מוקצית לרשומות חדשות. לישות יכול להיות רק סטטוס ברירת מחדל אחד.", "ru": "«По умолчанию» назначается новым записям. У сущности может быть только один статус по умолчанию."}	2026-06-05 11:02:47.349548+00	2026-07-07 14:01:01.922+00
107	statuses.keyHintPost	{"en": "). Unique within the entity.", "he": "). ייחודי בתוך הישות.", "ru": "). Уникален в пределах сущности."}	2026-06-05 11:02:47.343028+00	2026-07-07 14:01:01.962+00
99	statuses.daysShort	{"en": "d.", "he": "ימים", "ru": "дн."}	2026-06-05 11:02:47.326711+00	2026-07-07 14:01:01.917+00
137	users.colActions	{"en": "Actions", "he": "פעולות", "ru": "Действия"}	2026-06-05 11:02:47.407476+00	2026-07-07 14:01:02.005+00
135	users.colLanguage	{"en": "Language", "he": "שפה", "ru": "Язык"}	2026-06-05 11:02:47.403209+00	2026-07-07 14:01:02.008+00
154	users.resetPwTitle	{"en": "Reset password", "he": "איפוס סיסמה", "ru": "Сброс пароля"}	2026-06-05 11:02:47.444903+00	2026-07-07 14:01:02.241+00
149	users.save	{"en": "Save", "he": "שמירה", "ru": "Сохранить"}	2026-06-05 11:02:47.43334+00	2026-07-07 14:01:02.247+00
155	users.resetPwPrompt	{"en": "Enter a new password for", "he": "הזן סיסמה חדשה עבור", "ru": "Введите новый пароль для"}	2026-06-05 11:02:47.446711+00	2026-07-07 14:01:02.238+00
164	relations.selectTarget	{"en": "Select target entity", "he": "בחר ישות יעד", "ru": "Выберите целевую сущность"}	2026-06-05 11:02:47.465206+00	2026-07-07 14:01:01.406+00
169	relations.empty	{"en": "This entity has no relations yet. Click \\"Add relation\\" to create the first one.", "he": "לישות זו אין עדיין קשרים. לחץ על \\"הוסף קשר\\" כדי ליצור את הראשון.", "ru": "У этой сущности ещё нет связей. Нажмите «Добавить связь», чтобы создать первую."}	2026-06-05 11:02:47.475305+00	2026-07-07 14:01:01.357+00
162	relations.deleted	{"en": "Relation deleted", "he": "הקשר נמחק", "ru": "Связь удалена"}	2026-06-05 11:02:47.461005+00	2026-07-07 14:01:01.343+00
177	relations.dialogDescription	{"en": "A relation describes how this entity's records relate to the target entity's records.", "he": "קשר מתאר כיצד רשומות ישות זו מתייחסות לרשומות ישות היעד.", "ru": "Связь описывает, как записи этой сущности соотносятся с записями целевой сущности."}	2026-06-05 11:02:47.490926+00	2026-07-07 14:01:01.35+00
178	relations.fieldName	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-05 11:02:47.492782+00	2026-07-07 14:01:01.361+00
176	relations.newTitle	{"en": "New relation", "he": "קשר חדש", "ru": "Новая связь"}	2026-06-05 11:02:47.489232+00	2026-07-07 14:01:01.395+00
163	relations.deleteError	{"en": "Error deleting relation", "he": "שגיאה במחיקת הקשר", "ru": "Ошибка удаления связи"}	2026-06-05 11:02:47.46277+00	2026-07-07 14:01:01.346+00
159	relations.createError	{"en": "Error creating relation", "he": "שגיאה ביצירת הקשר", "ru": "Ошибка создания связи"}	2026-06-05 11:02:47.454468+00	2026-07-07 14:01:01.329+00
171	relations.colKey	{"en": "Key", "he": "מפתח", "ru": "Ключ"}	2026-06-05 11:02:47.479143+00	2026-07-07 14:01:01.306+00
181	relations.keyHintSuffix	{"en": "). Unique within the entity.", "he": "). ייחודי בתוך הישות.", "ru": "). Уникален в пределах сущности."}	2026-06-05 11:02:47.499294+00	2026-07-07 14:01:01.391+00
158	relations.created	{"en": "Relation created", "he": "הקשר נוצר", "ru": "Связь создана"}	2026-06-05 11:02:47.45276+00	2026-07-07 14:01:01.326+00
172	relations.colTarget	{"en": "Target", "he": "יעד", "ru": "Цель"}	2026-06-05 11:02:47.481466+00	2026-07-07 14:01:01.312+00
173	relations.colType	{"en": "Type", "he": "סוג", "ru": "Тип"}	2026-06-05 11:02:47.483323+00	2026-07-07 14:01:01.318+00
170	relations.colName	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-05 11:02:47.477274+00	2026-07-07 14:01:01.309+00
180	relations.keyHintPrefix	{"en": "Only lowercase Latin letters, digits and underscores (e.g. ", "he": "רק אותיות לטיניות קטנות, ספרות וקווים תחתונים (לדוגמה, ", "ru": "Только строчные латинские буквы, цифры и подчёркивания (например, "}	2026-06-05 11:02:47.49687+00	2026-07-07 14:01:01.388+00
182	relations.fieldTargetEntity	{"en": "Target entity", "he": "ישות יעד", "ru": "Целевая сущность"}	2026-06-05 11:02:47.501088+00	2026-07-07 14:01:01.372+00
175	relations.editTitle	{"en": "Edit relation", "he": "עריכת קשר", "ru": "Редактировать связь"}	2026-06-05 11:02:47.486973+00	2026-07-07 14:01:01.353+00
179	relations.fieldSystemKey	{"en": "System key", "he": "מפתח מערכת", "ru": "Системный ключ"}	2026-06-05 11:02:47.49447+00	2026-07-07 14:01:01.368+00
150	users.deleteTitle	{"en": "Delete user?", "he": "למחוק משתמש?", "ru": "Удалить пользователя?"}	2026-06-05 11:02:47.436084+00	2026-07-07 14:01:02.048+00
147	users.direction	{"en": "Direction", "he": "כיוון", "ru": "Направление"}	2026-06-05 11:02:47.428019+00	2026-07-07 14:01:02.051+00
165	relations.backToEntities	{"en": "Back to entities", "he": "חזרה לישויות", "ru": "К списку сущностей"}	2026-06-05 11:02:47.467022+00	2026-07-07 14:01:01.297+00
174	relations.colActions	{"en": "Actions", "he": "פעולות", "ru": "Действия"}	2026-06-05 11:02:47.48505+00	2026-07-07 14:01:01.304+00
142	users.firstName	{"en": "First name", "he": "שם פרטי", "ru": "Имя"}	2026-06-05 11:02:47.417464+00	2026-07-07 14:01:02.073+00
146	users.langRussian	{"en": "Russian", "he": "רוסית", "ru": "Русский"}	2026-06-05 11:02:47.426224+00	2026-07-07 14:01:02.184+00
160	relations.updated	{"en": "Relation updated", "he": "הקשר עודכן", "ru": "Связь обновлена"}	2026-06-05 11:02:47.457047+00	2026-07-07 14:01:01.42+00
168	relations.add	{"en": "Add relation", "he": "הוסף קשר", "ru": "Добавить связь"}	2026-06-05 11:02:47.473318+00	2026-07-07 14:01:01.293+00
166	relations.title	{"en": "Relations", "he": "קשרים", "ru": "Связи"}	2026-06-05 11:02:47.469416+00	2026-07-07 14:01:01.415+00
141	users.newTitle	{"en": "New user", "he": "משתמש חדש", "ru": "Новый пользователь"}	2026-06-05 11:02:47.415439+00	2026-07-07 14:01:02.222+00
153	users.delete	{"en": "Delete", "he": "מחיקה", "ru": "Удалить"}	2026-06-05 11:02:47.443114+00	2026-07-07 14:01:02.036+00
148	users.cancel	{"en": "Cancel", "he": "ביטול", "ru": "Отмена"}	2026-06-05 11:02:47.430769+00	2026-07-07 14:01:02.002+00
151	users.deleteConfirmPrefix	{"en": "User", "he": "המשתמש", "ru": "Пользователь"}	2026-06-05 11:02:47.438776+00	2026-07-07 14:01:02.039+00
152	users.deleteConfirmSuffix	{"en": "will be permanently deleted.", "he": "יימחק לצמיתות.", "ru": "будет удалён без возможности восстановления."}	2026-06-05 11:02:47.441163+00	2026-07-07 14:01:02.042+00
161	relations.updateError	{"en": "Update error", "he": "שגיאת עדכון", "ru": "Ошибка обновления"}	2026-06-05 11:02:47.459132+00	2026-07-07 14:01:01.424+00
156	users.newPasswordPlaceholder	{"en": "New password", "he": "סיסמה חדשה", "ru": "Новый пароль"}	2026-06-05 11:02:47.449242+00	2026-07-07 14:01:02.219+00
145	users.selectRole	{"en": "Select a role", "he": "בחר תפקיד", "ru": "Выберите роль"}	2026-06-05 11:02:47.424457+00	2026-07-07 14:01:02.255+00
143	users.lastName	{"en": "Last name", "he": "שם משפחה", "ru": "Фамилия"}	2026-06-05 11:02:47.419819+00	2026-07-07 14:01:02.187+00
144	users.password	{"en": "Password", "he": "סיסמה", "ru": "Пароль"}	2026-06-05 11:02:47.422053+00	2026-07-07 14:01:02.228+00
157	users.reset	{"en": "Reset", "he": "איפוס", "ru": "Сбросить"}	2026-06-05 11:02:47.451006+00	2026-07-07 14:01:02.235+00
187	relations.inverseHint	{"en": "How the relation looks from the target entity's side (e.g. \\"Project\\").", "he": "כיצד הקשר נראה מצד ישות היעד (לדוגמה, \\"פרויקט\\").", "ru": "Как связь выглядит со стороны целевой сущности (например, «Проект»)."}	2026-06-05 11:02:47.512004+00	2026-07-07 14:01:01.376+00
212	entities.statuses	{"en": "Statuses", "he": "סטטוסים", "ru": "Статусы"}	2026-06-05 11:02:47.562532+00	2026-07-07 14:00:58.106+00
216	entities.records	{"en": "Data", "he": "נתונים", "ru": "Данные"}	2026-06-05 11:02:47.570733+00	2026-07-07 14:00:58.091+00
218	entities.newTitle	{"en": "New entity", "he": "ישות חדשה", "ru": "Новая сущность"}	2026-06-05 11:02:47.579319+00	2026-07-07 14:00:58.077+00
213	entities.relations	{"en": "Relations", "he": "קשרים", "ru": "Связи"}	2026-06-05 11:02:47.564565+00	2026-07-07 14:00:58.094+00
221	entities.fieldDescription	{"en": "Description", "he": "תיאור", "ru": "Описание"}	2026-06-05 11:02:47.585724+00	2026-07-07 14:00:58.043+00
209	entities.statusActive	{"en": "Active", "he": "פעיל", "ru": "Активна"}	2026-06-05 11:02:47.556225+00	2026-07-07 14:00:58.102+00
225	entities.fieldIcon	{"en": "Icon", "he": "סמל", "ru": "Иконка"}	2026-06-05 11:02:47.593307+00	2026-07-07 14:00:58.046+00
211	entities.fields	{"en": "Fields", "he": "שדות", "ru": "Поля"}	2026-06-05 11:02:47.559819+00	2026-07-07 14:00:58.061+00
220	entities.fieldName	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-05 11:02:47.583869+00	2026-07-07 14:00:58.052+00
222	entities.fieldKey	{"en": "System key", "he": "מפתח מערכת", "ru": "Системный ключ"}	2026-06-05 11:02:47.587464+00	2026-07-07 14:00:58.05+00
215	entities.workflow	{"en": "Processes", "he": "תהליכים", "ru": "Процессы"}	2026-06-05 11:02:47.568353+00	2026-07-07 14:00:58.125+00
188	relations.cancel	{"en": "Cancel", "he": "ביטול", "ru": "Отмена"}	2026-06-05 11:02:47.514343+00	2026-07-07 14:01:01.3+00
199	entities.deleteError	{"en": "Error deleting entity", "he": "שגיאה במחיקת הישות", "ru": "Ошибка удаления сущности"}	2026-06-05 11:02:47.53595+00	2026-07-07 14:00:58.027+00
219	entities.dialogDesc	{"en": "An entity is a data object (table). Fields are added in the next step.", "he": "ישות היא אובייקט נתונים (טבלה). שדות מתווספים בשלב הבא.", "ru": "Сущность — это объект данных (таблица). Поля добавляются на следующем этапе."}	2026-06-05 11:02:47.581508+00	2026-07-07 14:00:58.031+00
190	relations.create	{"en": "Create", "he": "צור", "ru": "Создать"}	2026-06-05 11:02:47.518002+00	2026-07-07 14:01:01.322+00
193	relations.delete	{"en": "Delete", "he": "מחיקה", "ru": "Удалить"}	2026-06-05 11:02:47.524258+00	2026-07-07 14:01:01.332+00
198	entities.deleted	{"en": "Entity deleted", "he": "הישות נמחקה", "ru": "Сущность удалена"}	2026-06-05 11:02:47.534162+00	2026-07-07 14:00:58.025+00
195	entities.createError	{"en": "Error creating entity", "he": "שגיאה ביצירת הישות", "ru": "Ошибка создания сущности"}	2026-06-05 11:02:47.527923+00	2026-07-07 14:00:58.012+00
214	entities.views	{"en": "Views", "he": "תצוגות", "ru": "Виды"}	2026-06-05 11:02:47.566577+00	2026-07-07 14:00:58.122+00
186	relations.fieldInverseName	{"en": "Inverse name (optional)", "he": "שם הפוך (אופציונלי)", "ru": "Обратное название (необязательно)"}	2026-06-05 11:02:47.510043+00	2026-07-07 14:01:01.359+00
200	entities.title	{"en": "Entities", "he": "ישויות", "ru": "Сущности"}	2026-06-05 11:02:47.53813+00	2026-07-07 14:00:58.114+00
201	entities.subtitle	{"en": "Builder for your system's data objects", "he": "בונה אובייקטי הנתונים של המערכת", "ru": "Конструктор объектов данных вашей системы"}	2026-06-05 11:02:47.540779+00	2026-07-07 14:00:58.112+00
196	entities.updated	{"en": "Entity updated", "he": "הישות עודכנה", "ru": "Сущность обновлена"}	2026-06-05 11:02:47.530153+00	2026-07-07 14:00:58.117+00
197	entities.updateError	{"en": "Update error", "he": "שגיאת עדכון", "ru": "Ошибка обновления"}	2026-06-05 11:02:47.532435+00	2026-07-07 14:00:58.12+00
210	entities.statusHidden	{"en": "Hidden", "he": "מוסתר", "ru": "Скрыта"}	2026-06-05 11:02:47.558073+00	2026-07-07 14:00:58.109+00
223	entities.keyHintBefore	{"en": "Only lowercase latin letters, digits and underscores (e.g.", "he": "רק אותיות לטיניות קטנות, ספרות וקו תחתון (לדוגמה,", "ru": "Только строчные латинские буквы, цифры и подчёркивания (например,"}	2026-06-05 11:02:47.589296+00	2026-06-07 15:29:55.509+00
224	entities.keyHintAfter	{"en": "). Used in the data store.", "he": "). משמש באחסון הנתונים.", "ru": "). Используется в хранилище данных."}	2026-06-05 11:02:47.591412+00	2026-06-07 15:29:55.512+00
207	entities.colStatus	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-06-05 11:02:47.552277+00	2026-07-07 14:00:58.002+00
194	entities.created	{"en": "Entity created", "he": "הישות נוצרה", "ru": "Сущность создана"}	2026-06-05 11:02:47.52618+00	2026-07-07 14:00:58.009+00
208	entities.colActions	{"en": "Actions", "he": "פעולות", "ru": "Действия"}	2026-06-05 11:02:47.554492+00	2026-07-07 14:00:57.988+00
202	entities.create	{"en": "Create entity", "he": "צור ישות", "ru": "Создать сущность"}	2026-06-05 11:02:47.542673+00	2026-07-07 14:00:58.005+00
206	entities.colPage	{"en": "Page", "he": "דף", "ru": "Страница"}	2026-06-05 11:02:47.550583+00	2026-07-07 14:00:57.999+00
217	entities.editTitle	{"en": "Edit entity", "he": "עריכת ישות", "ru": "Редактировать сущность"}	2026-06-05 11:02:47.572926+00	2026-07-07 14:00:58.033+00
203	entities.empty	{"en": "No entities yet. Click \\"Create entity\\" to add the first one.", "he": "עדיין אין ישויות. לחץ על «צור ישות» כדי להוסיף את הראשונה.", "ru": "Сущности ещё не созданы. Нажмите «Создать сущность», чтобы добавить первую."}	2026-06-05 11:02:47.544489+00	2026-07-07 14:00:58.035+00
204	entities.colName	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-05 11:02:47.546968+00	2026-07-07 14:00:57.997+00
191	relations.deleteConfirmTitle	{"en": "Delete relation?", "he": "למחוק את הקשר?", "ru": "Удалить связь?"}	2026-06-05 11:02:47.519961+00	2026-07-07 14:01:01.34+00
205	entities.colKey	{"en": "Key", "he": "מפתח", "ru": "Ключ"}	2026-06-05 11:02:47.548783+00	2026-07-07 14:00:57.993+00
192	relations.deleteConfirmDesc	{"en": "will be deleted along with all record links.", "he": "יימחק יחד עם כל קישורי הרשומות.", "ru": "будет удалена вместе со всеми связями записей."}	2026-06-05 11:02:47.522205+00	2026-07-07 14:01:01.336+00
185	relations.fieldRelationType	{"en": "Relation type", "he": "סוג הקשר", "ru": "Тип связи"}	2026-06-05 11:02:47.508294+00	2026-07-07 14:01:01.365+00
189	relations.save	{"en": "Save", "he": "שמירה", "ru": "Сохранить"}	2026-06-05 11:02:47.516028+00	2026-07-07 14:01:01.398+00
264	views.condAll	{"en": "All conditions (AND)", "he": "כל התנאים (וגם)", "ru": "Все условия (И)"}	2026-06-05 11:02:47.672074+00	2026-07-07 14:01:02.322+00
256	views.editTitle	{"en": "Edit view", "he": "עריכת תצוגה", "ru": "Редактировать вид"}	2026-06-05 11:02:47.656086+00	2026-07-07 14:01:02.366+00
267	views.noFiltersHint	{"en": "Without filters all records are shown.", "he": "ללא מסננים מוצגות כל הרשומות.", "ru": "Без фильтров показываются все записи."}	2026-06-05 11:02:47.677582+00	2026-07-07 14:01:02.404+00
255	views.searchBadge	{"en": "search", "he": "חיפוש", "ru": "поиск"}	2026-06-05 11:02:47.653836+00	2026-07-07 14:01:02.472+00
248	views.noFields	{"en": "Configure the entity fields first — views filter and sort records by fields.", "he": "תחילה הגדר את שדות הישות — תצוגות מסננות וממיינות רשומות לפי שדות.", "ru": "Сначала настройте поля сущности — виды фильтруют и сортируют записи по полям."}	2026-06-05 11:02:47.640591+00	2026-07-07 14:01:02.401+00
257	views.newTitle	{"en": "New view", "he": "תצוגה חדשה", "ru": "Новый вид"}	2026-06-05 11:02:47.658404+00	2026-07-07 14:01:02.398+00
249	views.empty	{"en": "This entity has no views yet. Click \\"Add view\\" to create the first one.", "he": "לישות זו אין עדיין תצוגות. לחץ \\"הוסף תצוגה\\" כדי ליצור את הראשונה.", "ru": "У этой сущности ещё нет видов. Нажмите «Добавить вид», чтобы создать первый."}	2026-06-05 11:02:47.642509+00	2026-07-07 14:01:02.369+00
263	views.searchPlaceholder	{"en": "Substring across text fields", "he": "מחרוזת משנה בשדות טקסט", "ru": "Подстрока по текстовым полям"}	2026-06-05 11:02:47.66986+00	2026-07-07 14:01:02.476+00
252	views.filters	{"en": "Filters", "he": "מסננים", "ru": "Фильтры"}	2026-06-05 11:02:47.64849+00	2026-07-07 14:01:02.375+00
250	views.name	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-05 11:02:47.6445+00	2026-07-07 14:01:02.395+00
260	views.keyHint	{"en": "Only lowercase Latin letters, digits and underscores. Unique within the entity.", "he": "רק אותיות לטיניות קטנות, ספרות וקווים תחתונים. ייחודי בתוך הישות.", "ru": "Только строчные латинские буквы, цифры и подчёркивания. Уникален в пределах сущности."}	2026-06-05 11:02:47.664608+00	2026-07-07 14:01:02.384+00
251	views.key	{"en": "Key", "he": "מפתח", "ru": "Ключ"}	2026-06-05 11:02:47.646275+00	2026-07-07 14:01:02.378+00
232	entities.cancel	{"en": "Cancel", "he": "ביטול", "ru": "Отмена"}	2026-06-05 11:02:47.607607+00	2026-07-07 14:00:57.983+00
243	views.deleteError	{"en": "Error deleting view", "he": "שגיאה במחיקת תצוגה", "ru": "Ошибка удаления вида"}	2026-06-05 11:02:47.629567+00	2026-07-07 14:01:02.354+00
258	views.dialogDesc	{"en": "A view is a saved set of filters, sorting and search for the entity's records.", "he": "תצוגה היא קבוצה שמורה של מסננים, מיון וחיפוש עבור רשומות הישות.", "ru": "Вид — это сохранённый набор фильтров, сортировки и поиска для записей сущности."}	2026-06-05 11:02:47.660218+00	2026-07-07 14:01:02.363+00
237	entities.delete	{"en": "Delete", "he": "מחיקה", "ru": "Удалить"}	2026-06-05 11:02:47.617554+00	2026-07-07 14:00:58.017+00
236	entities.deleteConfirmDesc	{"en": "will be permanently deleted.", "he": "יימחק לצמיתות.", "ru": "будет удалена безвозвратно."}	2026-06-05 11:02:47.615493+00	2026-07-07 14:00:58.02+00
262	views.textSearch	{"en": "Text search", "he": "חיפוש טקסט", "ru": "Поиск по тексту"}	2026-06-05 11:02:47.66809+00	2026-07-07 14:01:02.514+00
242	views.deleted	{"en": "View deleted", "he": "התצוגה נמחקה", "ru": "Вид удалён"}	2026-06-05 11:02:47.627761+00	2026-07-07 14:01:02.35+00
259	views.systemKey	{"en": "System key", "he": "מפתח מערכת", "ru": "Системный ключ"}	2026-06-05 11:02:47.662098+00	2026-07-07 14:01:02.512+00
244	views.backToEntities	{"en": "Back to entities", "he": "חזרה לישויות", "ru": "К списку сущностей"}	2026-06-05 11:02:47.631902+00	2026-07-07 14:01:02.314+00
230	entities.pageHint	{"en": "On which menu page this entity will be shown.", "he": "באיזה דף תפריט תוצג ישות זו.", "ru": "На какой странице меню будет показана эта сущность."}	2026-06-05 11:02:47.60348+00	2026-07-07 14:00:58.079+00
254	views.actions	{"en": "Actions", "he": "פעולות", "ru": "Действия"}	2026-06-05 11:02:47.651912+00	2026-07-07 14:01:02.276+00
229	entities.pageUnboundOption	{"en": "— Not linked —", "he": "— לא מקושר —", "ru": "— Не привязана —"}	2026-06-05 11:02:47.60171+00	2026-07-07 14:00:58.087+00
228	entities.pageUnbound	{"en": "Not linked", "he": "לא מקושר", "ru": "Не привязана"}	2026-06-05 11:02:47.599873+00	2026-07-07 14:00:58.085+00
238	views.created	{"en": "View created", "he": "התצוגה נוצרה", "ru": "Вид создан"}	2026-06-05 11:02:47.619449+00	2026-07-07 14:01:02.333+00
253	views.sorting	{"en": "Sorting", "he": "מיון", "ru": "Сортировка"}	2026-06-05 11:02:47.650252+00	2026-07-07 14:01:02.483+00
265	views.condAny	{"en": "Any (OR)", "he": "כל אחד (או)", "ru": "Любое (ИЛИ)"}	2026-06-05 11:02:47.673984+00	2026-07-07 14:01:02.325+00
231	entities.fieldActive	{"en": "Active", "he": "פעיל", "ru": "Активна"}	2026-06-05 11:02:47.605237+00	2026-07-07 14:00:58.038+00
247	views.add	{"en": "Add view", "he": "הוסף תצוגה", "ru": "Добавить вид"}	2026-06-05 11:02:47.637478+00	2026-07-07 14:01:02.279+00
235	entities.deleteConfirmTitle	{"en": "Delete entity?", "he": "למחוק ישות?", "ru": "Удалить сущность?"}	2026-06-05 11:02:47.613073+00	2026-07-07 14:00:58.023+00
239	views.createError	{"en": "Error creating view", "he": "שגיאה ביצירת תצוגה", "ru": "Ошибка создания вида"}	2026-06-05 11:02:47.621393+00	2026-07-07 14:01:02.337+00
233	entities.save	{"en": "Save", "he": "שמירה", "ru": "Сохранить"}	2026-06-05 11:02:47.609374+00	2026-07-07 14:00:58.098+00
234	entities.createShort	{"en": "Create", "he": "צור", "ru": "Создать"}	2026-06-05 11:02:47.611145+00	2026-07-07 14:00:58.014+00
261	views.defaultView	{"en": "Default view", "he": "תצוגת ברירת מחדל", "ru": "Вид по умолчанию"}	2026-06-05 11:02:47.666298+00	2026-07-07 14:01:02.341+00
266	views.condition	{"en": "Condition", "he": "תנאי", "ru": "Условие"}	2026-06-05 11:02:47.675827+00	2026-07-07 14:01:02.327+00
245	views.title	{"en": "Views", "he": "תצוגות", "ru": "Виды"}	2026-06-05 11:02:47.633873+00	2026-07-07 14:01:02.517+00
240	views.updated	{"en": "View updated", "he": "התצוגה עודכנה", "ru": "Вид обновлён"}	2026-06-05 11:02:47.623664+00	2026-07-07 14:01:02.52+00
241	views.updateError	{"en": "Update error", "he": "שגיאת עדכון", "ru": "Ошибка обновления"}	2026-06-05 11:02:47.625487+00	2026-07-07 14:01:02.523+00
277	views.deleteConfirm	{"en": "will be deleted. Records are not affected.", "he": "יימחק. הרשומות אינן מושפעות.", "ru": "будет удалён. Записи не затрагиваются."}	2026-06-05 11:02:47.702874+00	2026-07-07 14:01:02.347+00
275	views.create	{"en": "Create", "he": "צור", "ru": "Создать"}	2026-06-05 11:02:47.698445+00	2026-07-07 14:01:02.33+00
285	views.op_gt	{"en": "greater than", "he": "גדול מ", "ru": "больше"}	2026-06-05 11:02:47.718915+00	2026-07-07 14:01:02.423+00
274	views.save	{"en": "Save", "he": "שמירה", "ru": "Сохранить"}	2026-06-05 11:02:47.696572+00	2026-07-07 14:01:02.465+00
305	workflow.colTransition	{"en": "Transition", "he": "מעבר", "ru": "Переход"}	2026-06-05 11:02:47.759713+00	2026-07-07 14:01:02.565+00
302	workflow.addTransition	{"en": "Add transition", "he": "הוסף מעבר", "ru": "Добавить переход"}	2026-06-05 11:02:47.752646+00	2026-07-07 14:01:02.532+00
308	workflow.colRequiredFields	{"en": "Required fields", "he": "שדות חובה", "ru": "Обяз. поля"}	2026-06-05 11:02:47.76562+00	2026-07-07 14:01:02.563+00
310	workflow.allRoles	{"en": "All roles", "he": "כל התפקידים", "ru": "Все роли"}	2026-06-05 11:02:47.76908+00	2026-07-07 14:01:02.536+00
271	views.asc	{"en": "Ascending", "he": "בסדר עולה", "ru": "По возрастанию"}	2026-06-05 11:02:47.689329+00	2026-07-07 14:01:02.282+00
299	workflow.backToEntities	{"en": "Back to entities", "he": "חזרה לישויות", "ru": "К списку сущностей"}	2026-06-05 11:02:47.746242+00	2026-07-07 14:01:02.542+00
306	workflow.colName	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-05 11:02:47.761432+00	2026-07-07 14:01:02.56+00
309	workflow.colActions	{"en": "Actions", "he": "פעולות", "ru": "Действия"}	2026-06-05 11:02:47.767349+00	2026-07-07 14:01:02.55+00
307	workflow.colWhoCan	{"en": "Who can", "he": "מי יכול", "ru": "Кто может"}	2026-06-05 11:02:47.76317+00	2026-07-07 14:01:02.569+00
297	workflow.deleteError	{"en": "Error deleting transition", "he": "שגיאה במחיקת המעבר", "ru": "Ошибка удаления перехода"}	2026-06-05 11:02:47.742439+00	2026-07-07 14:01:02.588+00
294	workflow.transitionUpdated	{"en": "Transition updated", "he": "המעבר עודכן", "ru": "Переход обновлён"}	2026-06-05 11:02:47.73626+00	2026-07-07 14:01:02.685+00
293	workflow.createError	{"en": "Error creating transition", "he": "שגיאה ביצירת המעבר", "ru": "Ошибка создания перехода"}	2026-06-05 11:02:47.734452+00	2026-07-07 14:01:02.575+00
295	workflow.updateError	{"en": "Update error", "he": "שגיאה בעדכון", "ru": "Ошибка обновления"}	2026-06-05 11:02:47.737961+00	2026-07-07 14:01:02.689+00
311	workflow.editTransition	{"en": "Edit transition", "he": "עריכת מעבר", "ru": "Редактировать переход"}	2026-06-05 11:02:47.770995+00	2026-07-07 14:01:02.597+00
304	workflow.empty	{"en": "No transitions yet. Without transitions, a record's status can be changed to any.", "he": "אין מעברים עדיין. ללא מעברים, ניתן לשנות את סטטוס הרשומה לכל סטטוס.", "ru": "Переходов пока нет. Без переходов статус записи можно менять на любой."}	2026-06-05 11:02:47.757451+00	2026-07-07 14:01:02.601+00
303	workflow.noStatusesWarning	{"en": "First create statuses for this entity — transitions are defined between them.", "he": "תחילה צור סטטוסים לישות זו — מעברים מוגדרים ביניהם.", "ru": "Сначала создайте статусы этой сущности — переходы определяются между ними."}	2026-06-05 11:02:47.754954+00	2026-07-07 14:01:02.633+00
292	workflow.transitionCreated	{"en": "Transition created", "he": "המעבר נוצר", "ru": "Переход создан"}	2026-06-05 11:02:47.732745+00	2026-07-07 14:01:02.679+00
296	workflow.transitionDeleted	{"en": "Transition deleted", "he": "המעבר נמחק", "ru": "Переход удалён"}	2026-06-05 11:02:47.740289+00	2026-07-07 14:01:02.682+00
298	workflow.specifyStatuses	{"en": "Specify transition statuses", "he": "ציין את סטטוסי המעבר", "ru": "Укажите статусы перехода"}	2026-06-05 11:02:47.744355+00	2026-07-07 14:01:02.661+00
300	workflow.title	{"en": "Processes", "he": "תהליכים", "ru": "Процессы"}	2026-06-05 11:02:47.748714+00	2026-07-07 14:01:02.672+00
273	views.cancel	{"en": "Cancel", "he": "ביטול", "ru": "Отмена"}	2026-06-05 11:02:47.694622+00	2026-07-07 14:01:02.317+00
287	views.op_lt	{"en": "less than", "he": "קטן מ", "ru": "меньше"}	2026-06-05 11:02:47.723265+00	2026-07-07 14:01:02.44+00
284	views.op_ends_with	{"en": "ends with", "he": "מסתיים ב", "ru": "заканчивается на"}	2026-06-05 11:02:47.717148+00	2026-07-07 14:01:02.417+00
280	views.op_neq	{"en": "not equal", "he": "לא שווה", "ru": "не равно"}	2026-06-05 11:02:47.708832+00	2026-07-07 14:01:02.45+00
282	views.op_not_contains	{"en": "does not contain", "he": "לא מכיל", "ru": "не содержит"}	2026-06-05 11:02:47.712881+00	2026-07-07 14:01:02.453+00
288	views.op_lte	{"en": "less or equal", "he": "קטן או שווה", "ru": "меньше или равно"}	2026-06-05 11:02:47.725422+00	2026-07-07 14:01:02.447+00
279	views.op_eq	{"en": "equals", "he": "שווה", "ru": "равно"}	2026-06-05 11:02:47.706492+00	2026-07-07 14:01:02.42+00
290	views.op_is_empty	{"en": "empty", "he": "ריק", "ru": "пусто"}	2026-06-05 11:02:47.728976+00	2026-07-07 14:01:02.432+00
278	views.delete	{"en": "Delete", "he": "מחיקה", "ru": "Удалить"}	2026-06-05 11:02:47.704724+00	2026-07-07 14:01:02.344+00
291	views.op_is_not_empty	{"en": "not empty", "he": "לא ריק", "ru": "не пусто"}	2026-06-05 11:02:47.73056+00	2026-07-07 14:01:02.436+00
276	views.deleteTitle	{"en": "Delete view?", "he": "למחוק תצוגה?", "ru": "Удалить вид?"}	2026-06-05 11:02:47.700995+00	2026-07-07 14:01:02.356+00
289	views.op_in	{"en": "one of (comma-separated)", "he": "אחד מ (מופרד בפסיקים)", "ru": "один из (через запятую)"}	2026-06-05 11:02:47.727175+00	2026-07-07 14:01:02.428+00
286	views.op_gte	{"en": "greater or equal", "he": "גדול או שווה", "ru": "больше или равно"}	2026-06-05 11:02:47.720744+00	2026-07-07 14:01:02.426+00
269	views.field	{"en": "Field", "he": "שדה", "ru": "Поле"}	2026-06-05 11:02:47.684069+00	2026-07-07 14:01:02.372+00
272	views.desc	{"en": "Descending", "he": "בסדר יורד", "ru": "По убыванию"}	2026-06-05 11:02:47.692788+00	2026-07-07 14:01:02.36+00
281	views.op_contains	{"en": "contains", "he": "מכיל", "ru": "содержит"}	2026-06-05 11:02:47.710925+00	2026-07-07 14:01:02.414+00
283	views.op_starts_with	{"en": "starts with", "he": "מתחיל ב", "ru": "начинается с"}	2026-06-05 11:02:47.714742+00	2026-07-07 14:01:02.459+00
336	workflow.delete	{"en": "Delete", "he": "מחיקה", "ru": "Удалить"}	2026-06-05 11:02:47.82195+00	2026-07-07 14:01:02.579+00
316	workflow.toStatus	{"en": "To status", "he": "לסטטוס", "ru": "В статус"}	2026-06-05 11:02:47.781107+00	2026-07-07 14:01:02.675+00
332	workflow.create	{"en": "Create", "he": "צור", "ru": "Создать"}	2026-06-05 11:02:47.813557+00	2026-07-07 14:01:02.572+00
341	fields.deleted	{"en": "Field deleted", "he": "השדה נמחק", "ru": "Поле удалено"}	2026-06-05 11:02:47.831603+00	2026-07-07 14:00:58.239+00
325	workflow.actionsLabel	{"en": "Actions on transition", "he": "פעולות במעבר", "ru": "Действия при переходе"}	2026-06-05 11:02:47.799041+00	2026-07-07 14:01:02.53+00
320	workflow.rolePrefix	{"en": "Role", "he": "תפקיד", "ru": "Роль"}	2026-06-05 11:02:47.789468+00	2026-07-07 14:01:02.649+00
340	fields.updateError	{"en": "Update error", "he": "שגיאת עדכון", "ru": "Ошибка обновления"}	2026-06-05 11:02:47.829805+00	2026-07-07 14:00:59.224+00
354	fields.yes	{"en": "Yes", "he": "כן", "ru": "Да"}	2026-06-05 11:02:47.857196+00	2026-07-07 14:00:59.246+00
342	fields.deleteError	{"en": "Error deleting field", "he": "שגיאה במחיקת השדה", "ru": "Ошибка удаления поля"}	2026-06-05 11:02:47.833397+00	2026-07-07 14:00:58.242+00
330	workflow.cancel	{"en": "Cancel", "he": "ביטול", "ru": "Отмена"}	2026-06-05 11:02:47.809006+00	2026-07-07 14:01:02.546+00
348	fields.name	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-05 11:02:47.845799+00	2026-07-07 14:00:58.976+00
344	fields.title	{"en": "Fields", "he": "שדות", "ru": "Поля"}	2026-06-05 11:02:47.837712+00	2026-07-07 14:00:59.112+00
350	fields.typeHeader	{"en": "Type", "he": "סוג", "ru": "Тип"}	2026-06-05 11:02:47.849551+00	2026-07-07 14:00:59.21+00
345	fields.subtitle	{"en": "Entity field structure", "he": "מבנה שדות הישות", "ru": "Структура полей сущности"}	2026-06-05 11:02:47.839562+00	2026-07-07 14:00:59.103+00
349	fields.key	{"en": "Key", "he": "מפתח", "ru": "Ключ"}	2026-06-05 11:02:47.847723+00	2026-07-07 14:00:58.957+00
352	fields.status	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-06-05 11:02:47.853626+00	2026-07-07 14:00:59.1+00
328	workflow.valuePlaceholder	{"en": "value", "he": "ערך", "ru": "значение"}	2026-06-05 11:02:47.805402+00	2026-07-07 14:01:02.692+00
338	fields.createError	{"en": "Error creating field", "he": "שגיאה ביצירת השדה", "ru": "Ошибка создания поля"}	2026-06-05 11:02:47.825645+00	2026-07-07 14:00:58.229+00
347	fields.empty	{"en": "This entity has no fields yet. Click \\"Add field\\" to create the first one.", "he": "לישות זו עדיין אין שדות. לחץ על «הוסף שדה» כדי ליצור את הראשון.", "ru": "У этой сущности ещё нет полей. Нажмите «Добавить поле», чтобы создать первое."}	2026-06-05 11:02:47.843452+00	2026-07-07 14:00:58.29+00
351	fields.required	{"en": "Required", "he": "חובה", "ru": "Обязательное"}	2026-06-05 11:02:47.851847+00	2026-07-07 14:00:59.05+00
318	workflow.whoCanExecute	{"en": "Who can execute", "he": "מי יכול לבצע", "ru": "Кто может выполнять"}	2026-06-05 11:02:47.785288+00	2026-07-07 14:01:02.696+00
339	fields.updated	{"en": "Field updated", "he": "השדה עודכן", "ru": "Поле обновлено"}	2026-06-05 11:02:47.827927+00	2026-07-07 14:00:59.216+00
337	fields.created	{"en": "Field created", "he": "השדה נוצר", "ru": "Поле создано"}	2026-06-05 11:02:47.823793+00	2026-07-07 14:00:58.226+00
346	fields.add	{"en": "Add field", "he": "הוסף שדה", "ru": "Добавить поле"}	2026-06-05 11:02:47.841258+00	2026-07-07 14:00:58.202+00
343	fields.backToEntities	{"en": "Back to entities", "he": "חזרה לישויות", "ru": "К списку сущностей"}	2026-06-05 11:02:47.835773+00	2026-07-07 14:00:58.21+00
353	fields.actions	{"en": "Actions", "he": "פעולות", "ru": "Действия"}	2026-06-05 11:02:47.855324+00	2026-07-07 14:00:58.194+00
333	workflow.deleteTitle	{"en": "Delete transition?", "he": "למחוק את המעבר?", "ru": "Удалить переход?"}	2026-06-05 11:02:47.815955+00	2026-07-07 14:01:02.59+00
326	workflow.field	{"en": "Field", "he": "שדה", "ru": "Поле"}	2026-06-05 11:02:47.800947+00	2026-07-07 14:01:02.605+00
331	workflow.save	{"en": "Save", "he": "שמירה", "ru": "Сохранить"}	2026-06-05 11:02:47.811501+00	2026-07-07 14:01:02.654+00
315	workflow.statusPlaceholder	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-06-05 11:02:47.778902+00	2026-07-07 14:01:02.665+00
314	workflow.fromStatus	{"en": "From status", "he": "מסטטוס", "ru": "Из статуса"}	2026-06-05 11:02:47.777026+00	2026-07-07 14:01:02.607+00
317	workflow.nameOptional	{"en": "Name (optional)", "he": "שם (אופציונלי)", "ru": "Название (необязательно)"}	2026-06-05 11:02:47.782918+00	2026-07-07 14:01:02.616+00
335	workflow.deleteConfirmSuffix	{"en": "will be permanently deleted.", "he": "יימחק לצמיתות.", "ru": "будет удалён безвозвратно."}	2026-06-05 11:02:47.820107+00	2026-07-07 14:01:02.585+00
322	workflow.requiredFieldsLabel	{"en": "Required fields for transition", "he": "שדות חובה למעבר", "ru": "Обязательные поля для перехода"}	2026-06-05 11:02:47.792965+00	2026-07-07 14:01:02.645+00
334	workflow.deleteConfirmPrefix	{"en": "Transition", "he": "מעבר", "ru": "Переход"}	2026-06-05 11:02:47.817804+00	2026-07-07 14:01:02.582+00
327	workflow.noActions	{"en": "No actions. You can automatically set field values.", "he": "אין פעולות. ניתן להגדיר ערכי שדות אוטומטית.", "ru": "Нет действий. Можно автоматически проставлять значения полей."}	2026-06-05 11:02:47.803279+00	2026-07-07 14:01:02.625+00
319	workflow.noRoles	{"en": "No roles.", "he": "אין תפקידים.", "ru": "Ролей нет."}	2026-06-05 11:02:47.787704+00	2026-07-07 14:01:02.63+00
323	workflow.noFields	{"en": "The entity has no fields.", "he": "לישות אין שדות.", "ru": "У сущности нет полей."}	2026-06-05 11:02:47.79515+00	2026-07-07 14:01:02.627+00
321	workflow.rolesHint	{"en": "If no role is selected, the transition is available to all roles.", "he": "אם לא נבחר תפקיד — המעבר זמין לכל התפקידים.", "ru": "Если не выбрана ни одна роль — переход доступен всем ролям."}	2026-06-05 11:02:47.791114+00	2026-07-07 14:01:02.651+00
329	workflow.order	{"en": "Sorting", "he": "מיון", "ru": "Порядок"}	2026-06-05 11:02:47.80726+00	2026-07-07 14:01:02.635+00
324	workflow.requiredFieldsHint	{"en": "These fields must be filled, otherwise the transition will not proceed.", "he": "שדות אלה חייבים להיות מלאים, אחרת המעבר לא יתבצע.", "ru": "Эти поля должны быть заполнены, иначе переход не выполнится."}	2026-06-05 11:02:47.797112+00	2026-07-07 14:01:02.642+00
367	fields.optionsPlaceholder	{"en": "New\\nIn progress\\nDone", "he": "חדש\\nבעבודה\\nהושלם", "ru": "Новая\\nВ работе\\nЗавершена"}	2026-06-05 11:02:47.882266+00	2026-07-07 14:00:59.037+00
360	fields.description	{"en": "Description", "he": "תיאור", "ru": "Описание"}	2026-06-05 11:02:47.868642+00	2026-07-07 14:00:58.262+00
372	fields.noRoles	{"en": "No roles to configure.", "he": "אין תפקידים להגדרה.", "ru": "Нет ролей для настройки."}	2026-06-05 11:02:47.892029+00	2026-07-07 14:00:58.989+00
375	fields.save	{"en": "Save", "he": "שמירה", "ru": "Сохранить"}	2026-06-05 11:02:47.897692+00	2026-07-07 14:00:59.057+00
361	fields.systemKey	{"en": "System key", "he": "מפתח מערכת", "ru": "Системный ключ"}	2026-06-05 11:02:47.870371+00	2026-07-07 14:00:59.107+00
390	fields.type.user	{"en": "User", "he": "משתמש", "ru": "Пользователь"}	2026-06-05 11:02:47.997669+00	2026-07-07 14:00:59.206+00
395	roles.createError	{"en": "Error creating role", "he": "שגיאה ביצירת תפקיד", "ru": "Ошибка создания роли"}	2026-06-05 11:02:48.008061+00	2026-07-07 14:01:01.563+00
380	fields.type.text	{"en": "Text", "he": "טקסט", "ru": "Текст"}	2026-06-05 11:02:47.90766+00	2026-07-07 14:00:59.195+00
392	fields.access.view	{"en": "View", "he": "צפייה", "ru": "Просмотр"}	2026-06-05 11:02:48.001361+00	2026-07-07 14:00:58.182+00
398	roles.deleted	{"en": "Role deleted", "he": "התפקיד נמחק", "ru": "Роль удалена"}	2026-06-05 11:02:48.014226+00	2026-07-07 14:01:01.571+00
397	roles.updateError	{"en": "Error updating role", "he": "שגיאה בעדכון תפקיד", "ru": "Ошибка обновления роли"}	2026-06-05 11:02:48.012286+00	2026-07-07 14:01:01.711+00
391	fields.access.edit	{"en": "Editing", "he": "עריכה", "ru": "Редактирование"}	2026-06-05 11:02:47.99949+00	2026-07-07 14:00:58.168+00
387	fields.type.email	{"en": "Email", "he": "אימייל", "ru": "Эл. почта"}	2026-06-05 11:02:47.991684+00	2026-07-07 14:00:59.141+00
383	fields.type.boolean	{"en": "Yes / No", "he": "כן / לא", "ru": "Да / Нет"}	2026-06-05 11:02:47.983785+00	2026-07-07 14:00:59.132+00
436	roles.cap.users	{"en": "Users", "he": "משתמשים", "ru": "Пользователи"}	2026-06-05 11:02:48.098113+00	2026-07-07 14:01:01.467+00
382	fields.type.number	{"en": "Number", "he": "מספר", "ru": "Число"}	2026-06-05 11:02:47.911412+00	2026-07-07 14:00:59.15+00
370	fields.accessByRoles	{"en": "Field access by roles", "he": "גישה לשדה לפי תפקידים", "ru": "Доступ к полю по ролям"}	2026-06-05 11:02:47.88779+00	2026-07-07 14:00:58.188+00
374	fields.cancel	{"en": "Cancel", "he": "ביטול", "ru": "Отмена"}	2026-06-05 11:02:47.895608+00	2026-07-07 14:00:58.214+00
381	fields.type.textarea	{"en": "Multiline text", "he": "טקסט מרובה שורות", "ru": "Многострочный текст"}	2026-06-05 11:02:47.90956+00	2026-07-07 14:00:59.198+00
356	fields.active	{"en": "Active", "he": "פעיל", "ru": "Активно"}	2026-06-05 11:02:47.861291+00	2026-07-07 14:00:58.198+00
376	fields.create	{"en": "Create", "he": "צור", "ru": "Создать"}	2026-06-05 11:02:47.89935+00	2026-07-07 14:00:58.222+00
379	fields.delete	{"en": "Delete", "he": "מחיקה", "ru": "Удалить"}	2026-06-05 11:02:47.905779+00	2026-07-07 14:00:58.235+00
369	fields.defaultValue	{"en": "Default value", "he": "ערך ברירת מחדל", "ru": "Значение по умолчанию"}	2026-06-05 11:02:47.885822+00	2026-07-07 14:00:58.232+00
378	fields.deleteSuffix	{"en": "will be permanently deleted.", "he": "יימחק לצמיתות.", "ru": "будет удалено безвозвратно."}	2026-06-05 11:02:47.903571+00	2026-07-07 14:00:58.245+00
364	fields.fieldType	{"en": "Field type", "he": "סוג השדה", "ru": "Тип поля"}	2026-06-05 11:02:47.876583+00	2026-07-07 14:00:58.298+00
373	fields.inherit	{"en": "Default", "he": "ברירת מחדל", "ru": "По умолчанию"}	2026-06-05 11:02:47.893901+00	2026-07-07 14:00:58.952+00
362	fields.keyHintPre	{"en": "Only lowercase Latin letters, digits and underscores (e.g. ", "he": "רק אותיות לטיניות קטנות, ספרות וקו תחתון (למשל, ", "ru": "Только строчные латинские буквы, цифры и подчёркивания (например, "}	2026-06-05 11:02:47.872078+00	2026-07-07 14:00:58.966+00
358	fields.newTitle	{"en": "New field", "he": "שדה חדש", "ru": "Новое поле"}	2026-06-05 11:02:47.864714+00	2026-07-07 14:00:58.982+00
366	fields.options	{"en": "List options", "he": "אפשרויות רשימה", "ru": "Варианты списка"}	2026-06-05 11:02:47.880035+00	2026-07-07 14:00:59.03+00
368	fields.optionsHint	{"en": "One option per line.", "he": "אפשרות אחת בכל שורה.", "ru": "По одному варианту на строку."}	2026-06-05 11:02:47.884057+00	2026-07-07 14:00:59.033+00
389	fields.type.phone	{"en": "Phone", "he": "טלפון", "ru": "Телефон"}	2026-06-05 11:02:47.995699+00	2026-07-07 14:00:59.188+00
388	fields.type.url	{"en": "Link (URL)", "he": "קישור (URL)", "ru": "Ссылка (URL)"}	2026-06-05 11:02:47.993407+00	2026-07-07 14:00:59.203+00
394	roles.created	{"en": "Role created", "he": "התפקיד נוצר", "ru": "Роль создана"}	2026-06-05 11:02:48.006111+00	2026-07-07 14:01:01.56+00
377	fields.deleteTitle	{"en": "Delete field?", "he": "למחוק שדה?", "ru": "Удалить поле?"}	2026-06-05 11:02:47.901212+00	2026-07-07 14:00:58.248+00
365	fields.sortOrder	{"en": "Sorting", "he": "מיון", "ru": "Порядок"}	2026-06-05 11:02:47.878318+00	2026-07-07 14:00:59.097+00
393	fields.access.hidden	{"en": "Hidden", "he": "מוסתר", "ru": "Скрыто"}	2026-06-05 11:02:48.004174+00	2026-07-07 14:00:58.171+00
396	roles.updated	{"en": "Role updated", "he": "התפקיד עודכן", "ru": "Роль обновлена"}	2026-06-05 11:02:48.009926+00	2026-07-07 14:01:01.709+00
384	fields.type.date	{"en": "Date", "he": "תאריך", "ru": "Дата"}	2026-06-05 11:02:47.985699+00	2026-07-07 14:00:59.136+00
385	fields.type.datetime	{"en": "Date and time", "he": "תאריך ושעה", "ru": "Дата и время"}	2026-06-05 11:02:47.987986+00	2026-07-07 14:00:59.138+00
386	fields.type.select	{"en": "List (select)", "he": "רשימה (בחירה)", "ru": "Список (выбор)"}	2026-06-05 11:02:47.989842+00	2026-07-07 14:00:59.191+00
363	fields.keyHintPost	{"en": "). Unique within the entity.", "he": "). ייחודי בתוך הישות.", "ru": "). Уникален в пределах сущности."}	2026-06-05 11:02:47.874657+00	2026-07-07 14:00:58.963+00
430	roles.noUserFields	{"en": "No \\"User\\" type fields — when \\"Own only\\" is selected, records will not be visible. Add such a field to the entity.", "he": "אין שדות מסוג «משתמש» — בבחירת «רק שלי» הרשומות לא יוצגו. הוסיפו שדה כזה לישות.", "ru": "Нет полей типа «Пользователь» — при выборе «Только свои» записи не будут видны. Добавьте такое поле в сущность."}	2026-06-05 11:02:48.085803+00	2026-07-07 14:01:01.629+00
408	roles.name	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-05 11:02:48.037597+00	2026-07-07 14:01:01.611+00
416	roles.noEntities	{"en": "No entities.", "he": "אין ישויות.", "ru": "Нет сущностей."}	2026-06-05 11:02:48.053985+00	2026-07-07 14:01:01.622+00
420	roles.noViewableEntities	{"en": "No entities with view permission.", "he": "אין ישויות עם הרשאת צפייה.", "ru": "Нет сущностей с правом просмотра."}	2026-06-05 11:02:48.061683+00	2026-07-07 14:01:01.632+00
413	roles.pageAccess	{"en": "Page access", "he": "גישה לדפים", "ru": "Доступ к страницам"}	2026-06-05 11:02:48.047853+00	2026-07-07 14:01:01.641+00
410	roles.superAdmin	{"en": "Full access (super admin)", "he": "גישה מלאה (מנהל על)", "ru": "Полный доступ (суперадмин)"}	2026-06-05 11:02:48.041777+00	2026-07-07 14:01:01.7+00
403	roles.empty	{"en": "No roles found", "he": "לא נמצאו תפקידים", "ru": "Роли не найдены"}	2026-06-05 11:02:48.025808+00	2026-07-07 14:01:01.599+00
422	roles.save	{"en": "Save", "he": "שמירה", "ru": "Сохранить"}	2026-06-05 11:02:48.065973+00	2026-07-07 14:01:01.652+00
226	entities.fieldOrder	{"en": "Sorting", "he": "מיון", "ru": "Порядок"}	2026-06-05 11:02:47.595179+00	2026-07-07 14:00:58.055+00
428	roles.scopeAll	{"en": "All", "he": "הכול", "ru": "Все"}	2026-06-05 11:02:48.081706+00	2026-07-07 14:01:01.655+00
427	roles.delete	{"en": "Delete", "he": "מחיקה", "ru": "Удалить"}	2026-06-05 11:02:48.079106+00	2026-07-07 14:01:01.569+00
424	roles.deleteTitle	{"en": "Delete role?", "he": "למחוק תפקיד?", "ru": "Удалить роль?"}	2026-06-05 11:02:48.070278+00	2026-07-07 14:01:01.586+00
434	roles.cap.entities	{"en": "Entities (fields, statuses, relations, views)", "he": "ישויות (שדות, סטטוסים, קשרים, תצוגות)", "ru": "Сущности (поля, статусы, связи, виды)"}	2026-06-05 11:02:48.093977+00	2026-07-07 14:01:01.448+00
432	roles.noOwnerSelected	{"en": "No owner field selected — with \\"Own only\\" records will not be visible. Select at least one field.", "he": "לא נבחר אף שדה בעלים — עם «רק שלי» הרשומות לא יוצגו. סמנו לפחות שדה אחד.", "ru": "Не выбрано ни одного поля-владельца — при «Только свои» записи не будут видны. Отметьте хотя бы одно поле."}	2026-06-05 11:02:48.090192+00	2026-07-07 14:01:01.625+00
435	roles.cap.roles	{"en": "Roles", "he": "תפקידים", "ru": "Роли"}	2026-06-05 11:02:48.095802+00	2026-07-07 14:01:01.46+00
400	roles.title	{"en": "Roles", "he": "תפקידים", "ru": "Роли"}	2026-06-05 11:02:48.01825+00	2026-07-07 14:01:01.707+00
431	roles.ownerFields	{"en": "Owner fields (match by any):", "he": "שדות בעלים (התאמה לפי כל אחד):", "ru": "Поля-владельцы (совпадение по любому):"}	2026-06-05 11:02:48.08777+00	2026-07-07 14:01:01.635+00
433	roles.cap.pages	{"en": "Pages", "he": "דפים", "ru": "Страницы"}	2026-06-05 11:02:48.092165+00	2026-07-07 14:01:01.456+00
402	roles.create	{"en": "Create role", "he": "צור תפקיד", "ru": "Создать роль"}	2026-06-05 11:02:48.023457+00	2026-07-07 14:01:01.557+00
415	roles.recordRights	{"en": "Record permissions by entity", "he": "הרשאות רשומות לפי ישות", "ru": "Права на записи по сущностям"}	2026-06-05 11:02:48.051772+00	2026-07-07 14:01:01.644+00
407	roles.newTitle	{"en": "New role", "he": "תפקיד חדש", "ru": "Новая роль"}	2026-06-05 11:02:48.035061+00	2026-07-07 14:01:01.615+00
425	roles.deletePrefix	{"en": "Role", "he": "תפקיד", "ru": "Роль"}	2026-06-05 11:02:48.072281+00	2026-07-07 14:01:01.579+00
412	roles.adminSections	{"en": "Administration sections", "he": "מקטעי ניהול", "ru": "Разделы администрирования"}	2026-06-05 11:02:48.046008+00	2026-07-07 14:01:01.442+00
409	roles.description	{"en": "Description", "he": "תיאור", "ru": "Описание"}	2026-06-05 11:02:48.039838+00	2026-07-07 14:01:01.593+00
417	roles.entity	{"en": "Entity", "he": "ישות", "ru": "Сущность"}	2026-06-05 11:02:48.055827+00	2026-07-07 14:01:01.602+00
406	roles.editTitle	{"en": "Edit role", "he": "עריכת תפקיד", "ru": "Редактировать роль"}	2026-06-05 11:02:48.032692+00	2026-07-07 14:01:01.596+00
414	roles.noContentPages	{"en": "No content pages.", "he": "אין דפי תוכן.", "ru": "Нет контентных страниц."}	2026-06-05 11:02:48.049855+00	2026-07-07 14:01:01.618+00
421	roles.cancel	{"en": "Cancel", "he": "ביטול", "ru": "Отмена"}	2026-06-05 11:02:48.063571+00	2026-07-07 14:01:01.445+00
426	roles.deleteSuffix	{"en": "will be deleted. Make sure no users have this role.", "he": "יימחק. ודאו שאין משתמשים עם תפקיד זה.", "ru": "будет удалена. Убедитесь, что нет пользователей с этой ролью."}	2026-06-05 11:02:48.076894+00	2026-07-07 14:01:01.583+00
423	roles.createShort	{"en": "Create", "he": "צור", "ru": "Создать"}	2026-06-05 11:02:48.067885+00	2026-07-07 14:01:01.566+00
418	roles.recordScope	{"en": "Record visibility scope", "he": "היקף נראות רשומות", "ru": "Область видимости записей"}	2026-06-05 11:02:48.057655+00	2026-07-07 14:01:01.647+00
429	roles.scopeOwn	{"en": "Own only", "he": "רק שלי", "ru": "Только свои"}	2026-06-05 11:02:48.083802+00	2026-07-07 14:01:01.658+00
404	roles.fullAccess	{"en": "Full access", "he": "גישה מלאה", "ru": "Полный доступ"}	2026-06-05 11:02:48.028367+00	2026-07-07 14:01:01.605+00
405	roles.usersCount	{"en": "users", "he": "משתמשים", "ru": "пользователей"}	2026-06-05 11:02:48.030489+00	2026-07-07 14:01:01.714+00
401	roles.subtitle	{"en": "Manage roles and access permissions", "he": "ניהול תפקידים והרשאות גישה", "ru": "Управление ролями и правами доступа"}	2026-06-05 11:02:48.020856+00	2026-07-07 14:01:01.695+00
471	records.shown	{"en": "Shown", "he": "מוצג", "ru": "Показано"}	2026-06-05 11:02:48.176851+00	2026-07-07 14:01:01.108+00
444	records.createError	{"en": "Error creating record", "he": "שגיאה ביצירת רשומה", "ru": "Ошибка создания записи"}	2026-06-05 11:02:48.116315+00	2026-07-07 14:01:00.578+00
457	records.allRecords	{"en": "All records", "he": "כל הרשומות", "ru": "Все записи"}	2026-06-05 11:02:48.145574+00	2026-07-07 14:01:00.488+00
453	records.noAccess	{"en": "No access to records", "he": "אין גישה לרשומות", "ru": "Нет доступа к записям"}	2026-06-05 11:02:48.136876+00	2026-07-07 14:01:01.034+00
475	records.next	{"en": "Next", "he": "הבא", "ru": "Вперёд"}	2026-06-05 11:02:48.185344+00	2026-07-07 14:01:01.015+00
468	records.history	{"en": "Change history", "he": "היסטוריית שינויים", "ru": "История изменений"}	2026-06-05 11:02:48.17035+00	2026-07-07 14:01:00.937+00
477	records.newTitle	{"en": "New record", "he": "רשומה חדשה", "ru": "Новая запись"}	2026-06-05 11:02:48.189796+00	2026-07-07 14:01:01.01+00
467	records.inArchive	{"en": "Archived", "he": "בארכיון", "ru": "В архиве"}	2026-06-05 11:02:48.16777+00	2026-07-07 14:01:00.96+00
473	records.prev	{"en": "Back", "he": "הקודם", "ru": "Назад"}	2026-06-05 11:02:48.181047+00	2026-07-07 14:01:01.06+00
479	records.readOnly	{"en": "(read only)", "he": "(קריאה בלבד)", "ru": "(только чтение)"}	2026-06-05 11:02:48.194237+00	2026-07-07 14:01:01.064+00
461	records.filterAll	{"en": "All", "he": "הכול", "ru": "Все"}	2026-06-05 11:02:48.154586+00	2026-07-07 14:01:00.724+00
460	records.filterArchived	{"en": "Archive", "he": "ארכיון", "ru": "Архив"}	2026-06-05 11:02:48.152123+00	2026-07-07 14:01:00.728+00
469	records.restoreFromArchive	{"en": "Restore from archive", "he": "שחזר מהארכיון", "ru": "Восстановить из архива"}	2026-06-05 11:02:48.172731+00	2026-07-07 14:01:01.08+00
458	records.searchPlaceholder	{"en": "Search…", "he": "חיפוש…", "ru": "Поиск…"}	2026-06-05 11:02:48.147561+00	2026-07-07 14:01:01.09+00
472	records.of	{"en": "of", "he": "מתוך", "ru": "из"}	2026-06-05 11:02:48.178781+00	2026-07-07 14:01:01.055+00
474	records.page	{"en": "Page", "he": "עמ'", "ru": "Стр."}	2026-06-05 11:02:48.182927+00	2026-07-07 14:01:01.058+00
464	records.emptyNone	{"en": "No records yet. Click \\"Add record\\" to create the first one.", "he": "עדיין אין רשומות. לחץ \\"הוסף רשומה\\" כדי ליצור את הראשונה.", "ru": "Записей пока нет. Нажмите «Добавить запись», чтобы создать первую."}	2026-06-05 11:02:48.160922+00	2026-07-07 14:01:00.659+00
459	records.filterActive	{"en": "Active", "he": "פעילים", "ru": "Активные"}	2026-06-05 11:02:48.15015+00	2026-07-07 14:01:00.721+00
466	records.actions	{"en": "Actions", "he": "פעולות", "ru": "Действия"}	2026-06-05 11:02:48.165475+00	2026-07-07 14:01:00.46+00
462	records.add	{"en": "Add record", "he": "הוסף רשומה", "ru": "Добавить запись"}	2026-06-05 11:02:48.1565+00	2026-07-07 14:01:00.466+00
480	records.noStatus	{"en": "No status", "he": "ללא סטטוס", "ru": "Без статуса"}	2026-06-05 11:02:48.196017+00	2026-07-07 14:01:01.052+00
448	records.deleteError	{"en": "Error deleting record", "he": "שגיאה במחיקת רשומה", "ru": "Ошибка удаления записи"}	2026-06-05 11:02:48.124975+00	2026-07-07 14:01:00.628+00
452	records.unarchiveError	{"en": "Restore error", "he": "שגיאת שחזור", "ru": "Ошибка восстановления"}	2026-06-05 11:02:48.13391+00	2026-07-07 14:01:01.129+00
446	records.updateError	{"en": "Update error", "he": "שגיאת עדכון", "ru": "Ошибка обновления"}	2026-06-05 11:02:48.120435+00	2026-07-07 14:01:01.183+00
445	records.updated	{"en": "Record updated", "he": "הרשומה עודכנה", "ru": "Запись обновлена"}	2026-06-05 11:02:48.11857+00	2026-07-07 14:01:01.133+00
455	records.noFields	{"en": "This entity has no fields yet", "he": "לישות זו אין עדיין שדות", "ru": "У этой сущности ещё нет полей"}	2026-06-05 11:02:48.141237+00	2026-07-07 14:01:01.043+00
470	records.toArchive	{"en": "Archive", "he": "לארכיון", "ru": "В архив"}	2026-06-05 11:02:48.174605+00	2026-07-07 14:01:01.119+00
451	records.unarchived	{"en": "Record restored from archive", "he": "הרשומה שוחזרה מהארכיון", "ru": "Запись восстановлена из архива"}	2026-06-05 11:02:48.131803+00	2026-07-07 14:01:01.126+00
476	records.editTitle	{"en": "Edit record", "he": "עריכת רשומה", "ru": "Редактировать запись"}	2026-06-05 11:02:48.187204+00	2026-07-07 14:01:00.653+00
454	records.noAccessDesc	{"en": "Your role does not have permission to view this entity's data.", "he": "לתפקיד שלך אין הרשאה לצפות בנתוני ישות זו.", "ru": "У вашей роли нет прав на просмотр данных этой сущности."}	2026-06-05 11:02:48.13888+00	2026-07-07 14:01:01.037+00
441	roles.action.delete	{"en": "Delete", "he": "מחיקה", "ru": "Удаление"}	2026-06-05 11:02:48.110087+00	2026-07-07 14:01:01.431+00
439	roles.action.create	{"en": "Create", "he": "יצירה", "ru": "Создание"}	2026-06-05 11:02:48.105033+00	2026-07-07 14:01:01.428+00
447	records.deleted	{"en": "Record deleted", "he": "הרשומה נמחקה", "ru": "Запись удалена"}	2026-06-05 11:02:48.123083+00	2026-07-07 14:01:00.625+00
463	records.emptyFiltered	{"en": "No records match the conditions.", "he": "אין רשומות התואמות לתנאים.", "ru": "Нет записей, удовлетворяющих условиям."}	2026-06-05 11:02:48.159008+00	2026-07-07 14:01:00.656+00
478	records.dialogDesc	{"en": "Fill in the record fields. Required fields are marked with an asterisk.", "he": "מלא את שדות הרשומה. שדות חובה מסומנים בכוכבית.", "ru": "Заполните поля записи. Обязательные поля помечены звёздочкой."}	2026-06-05 11:02:48.191714+00	2026-07-07 14:01:00.638+00
449	records.archived	{"en": "Record archived", "he": "הרשומה הועברה לארכיון", "ru": "Запись отправлена в архив"}	2026-06-05 11:02:48.127242+00	2026-07-07 14:01:00.491+00
443	records.created	{"en": "Record created", "he": "הרשומה נוצרה", "ru": "Запись создана"}	2026-06-05 11:02:48.114366+00	2026-07-07 14:01:00.575+00
450	records.archiveError	{"en": "Archiving error", "he": "שגיאת ארכוב", "ru": "Ошибка архивации"}	2026-06-05 11:02:48.12925+00	2026-07-07 14:01:00.494+00
438	roles.action.view	{"en": "View", "he": "צפייה", "ru": "Просмотр"}	2026-06-05 11:02:48.102395+00	2026-07-07 14:01:01.437+00
465	records.status	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-06-05 11:02:48.163634+00	2026-07-07 14:01:01.111+00
440	roles.action.update	{"en": "Edit", "he": "עריכה", "ru": "Изменение"}	2026-06-05 11:02:48.107705+00	2026-07-07 14:01:01.433+00
506	records.linkDeleteError	{"en": "Failed to delete link", "he": "נכשל במחיקת קישור", "ru": "Не удалось удалить связь"}	2026-06-05 11:02:48.254033+00	2026-07-07 14:01:00.97+00
486	records.deleteTitle	{"en": "Delete record?", "he": "למחוק רשומה?", "ru": "Удалить запись?"}	2026-06-05 11:02:48.210021+00	2026-07-07 14:01:00.634+00
490	records.yes	{"en": "Yes", "he": "כן", "ru": "Да"}	2026-06-05 11:02:48.218795+00	2026-07-07 14:01:01.29+00
488	records.delete	{"en": "Delete", "he": "מחיקה", "ru": "Удалить"}	2026-06-05 11:02:48.214443+00	2026-07-07 14:01:00.617+00
167	relations.subtitle	{"en": "Relations between entities: how this entity's records relate to others", "he": "קשרים בין ישויות: כיצד רשומות ישות זו מתייחסות לאחרות", "ru": "Связи между сущностями: как записи этой сущности соотносятся с записями других"}	2026-06-05 11:02:47.471126+00	2026-07-07 14:01:01.408+00
102	statuses.editTitle	{"en": "Edit status", "he": "עריכת סטטוס", "ru": "Редактировать статус"}	2026-06-05 11:02:47.333061+00	2026-07-07 14:01:01.946+00
96	statuses.default	{"en": "Default", "he": "ברירת מחדל", "ru": "По умолчанию"}	2026-06-05 11:02:47.318881+00	2026-07-07 14:01:01.92+00
184	relations.targetLocked	{"en": "The target entity cannot be changed after creation.", "he": "לא ניתן לשנות את ישות היעד לאחר היצירה.", "ru": "Целевую сущность нельзя изменить после создания."}	2026-06-05 11:02:47.506109+00	2026-07-07 14:01:01.412+00
140	users.editTitle	{"en": "Edit user", "he": "עריכת משתמש", "ru": "Редактировать пользователя"}	2026-06-05 11:02:47.413052+00	2026-07-07 14:01:02.053+00
492	records.historyEmpty	{"en": "No changes yet", "he": "אין שינויים עדיין", "ru": "Изменений пока нет"}	2026-06-05 11:02:48.223033+00	2026-07-07 14:01:00.943+00
52	pages.deleteChildrenError	{"en": "Cannot delete a page with children", "he": "לא ניתן למחוק דף עם דפי משנה", "ru": "Нельзя удалить страницу с дочерними"}	2026-06-05 11:02:47.225714+00	2026-07-07 14:01:00.265+00
495	records.field	{"en": "Field", "he": "שדה", "ru": "Поле"}	2026-06-05 11:02:48.22945+00	2026-07-07 14:01:00.666+00
489	records.historyDesc	{"en": "Who changed what and when: previous value → new.", "he": "מי שינה מה ומתי: ערך קודם ← חדש.", "ru": "Кто, когда и что изменил: прежнее значение → новое."}	2026-06-05 11:02:48.216319+00	2026-07-07 14:01:00.94+00
139	users.active	{"en": "Active", "he": "פעיל", "ru": "Активен"}	2026-06-05 11:02:47.411281+00	2026-07-07 14:01:01.993+00
183	relations.selectEntityPlaceholder	{"en": "Select entity", "he": "בחר ישות", "ru": "Выберите сущность"}	2026-06-05 11:02:47.50296+00	2026-07-07 14:01:01.402+00
487	records.deleteConfirm	{"en": "The record will be permanently deleted.", "he": "הרשומה תימחק לצמיתות.", "ru": "Запись будет удалена безвозвратно."}	2026-06-05 11:02:48.211951+00	2026-07-07 14:01:00.621+00
501	records.deleteLink	{"en": "Delete link", "he": "מחק קישור", "ru": "Удалить связь"}	2026-06-05 11:02:48.242681+00	2026-07-07 14:01:00.632+00
49	pages.createError	{"en": "Error creating page", "he": "שגיאה ביצירת הדף", "ru": "Ошибка создания страницы"}	2026-06-05 11:02:47.218778+00	2026-07-07 14:01:00.25+00
496	records.change	{"en": "Change", "he": "שינוי", "ru": "Изменение"}	2026-06-05 11:02:48.231675+00	2026-07-07 14:01:00.505+00
104	statuses.dialogDesc	{"en": "A status is a stage in a record's lifecycle (e.g. \\"New\\", \\"In progress\\", \\"Completed\\").", "he": "סטטוס הוא שלב במחזור החיים של רשומה (למשל \\"חדש\\", \\"בעבודה\\", \\"הושלם\\").", "ru": "Статус — это этап жизненного цикла записи (например, «Новая», «В работе», «Завершена»)."}	2026-06-05 11:02:47.336686+00	2026-07-07 14:01:01.943+00
483	records.cancel	{"en": "Cancel", "he": "ביטול", "ru": "Отмена"}	2026-06-05 11:02:48.203118+00	2026-07-07 14:01:00.502+00
504	records.link	{"en": "Link", "he": "קשר", "ru": "Связать"}	2026-06-05 11:02:48.249399+00	2026-07-07 14:01:00.964+00
16	layout.language	{"en": "Language", "he": "שפה", "ru": "Язык"}	2026-06-05 11:02:47.018228+00	2026-07-07 14:00:59.88+00
19	login.error	{"en": "Login error", "he": "שגיאת התחברות", "ru": "Ошибка входа"}	2026-06-05 11:02:47.14595+00	2026-07-07 14:00:59.897+00
22	login.subtitle	{"en": "Enter your credentials to access the platform", "he": "הזן את פרטי הכניסה שלך כדי לגשת לפלטפורמה", "ru": "Введите ваши учётные данные для доступа к платформе"}	2026-06-05 11:02:47.154128+00	2026-07-07 14:00:59.915+00
503	records.selectRecord	{"en": "Select record", "he": "בחר רשומה", "ru": "Выберите запись"}	2026-06-05 11:02:48.247022+00	2026-07-07 14:01:01.094+00
497	records.selectUser	{"en": "Select user", "he": "בחר משתמש", "ru": "Выберите пользователя"}	2026-06-05 11:02:48.233546+00	2026-07-07 14:01:01.096+00
498	records.selectValue	{"en": "Select value", "he": "בחר ערך", "ru": "Выберите значение"}	2026-06-05 11:02:48.236483+00	2026-07-07 14:01:01.1+00
482	records.transitionRequired	{"en": "To transition, fill in:", "he": "למעבר יש למלא:", "ru": "Для перехода нужно заполнить:"}	2026-06-05 11:02:48.200783+00	2026-07-07 14:01:01.123+00
493	records.when	{"en": "When", "he": "מתי", "ru": "Когда"}	2026-06-05 11:02:48.225267+00	2026-07-07 14:01:01.279+00
494	records.who	{"en": "Who", "he": "מי", "ru": "Кто"}	2026-06-05 11:02:48.227717+00	2026-07-07 14:01:01.283+00
499	records.links	{"en": "Relations", "he": "קשרים", "ru": "Связи"}	2026-06-05 11:02:48.238461+00	2026-07-07 14:01:00.977+00
502	records.noAvailable	{"en": "No available records", "he": "אין רשומות זמינות", "ru": "Нет доступных записей"}	2026-06-05 11:02:48.245085+00	2026-07-07 14:01:01.04+00
491	records.no	{"en": "No", "he": "לא", "ru": "Нет"}	2026-06-05 11:02:48.220642+00	2026-07-07 14:01:01.031+00
500	records.noLinks	{"en": "No linked records.", "he": "אין רשומות מקושרות.", "ru": "Связанных записей нет."}	2026-06-05 11:02:48.24088+00	2026-07-07 14:01:01.049+00
484	records.save	{"en": "Save", "he": "שמירה", "ru": "Сохранить"}	2026-06-05 11:02:48.205599+00	2026-07-07 14:01:01.083+00
505	records.linkAddError	{"en": "Failed to add link", "he": "נכשל בהוספת קישור", "ru": "Не удалось добавить связь"}	2026-06-05 11:02:48.251654+00	2026-07-07 14:01:00.967+00
485	records.create	{"en": "Create", "he": "צור", "ru": "Создать"}	2026-06-05 11:02:48.207594+00	2026-07-07 14:01:00.572+00
1011	layout.stopImpersonation	{"en": "Return to", "he": "חזרה אל", "ru": "Вернуться к"}	2026-06-05 14:15:58.620772+00	2026-07-07 14:00:59.895+00
357	fields.editTitle	{"en": "Edit field", "he": "עריכת שדה", "ru": "Редактировать поле"}	2026-06-05 11:02:47.862977+00	2026-07-07 14:00:58.285+00
419	roles.recordScopeDesc	{"en": "\\"All\\" — the role sees all records of the entity. \\"Own only\\" — only records where the selected \\"User\\" field equals the current user are visible.", "he": "«הכול» — התפקיד רואה את כל הרשומות של הישות. «רק שלי» — מוצגות רק רשומות שבהן שדה ה«משתמש» הנבחר שווה למשתמש הנוכחי.", "ru": "«Все» — роль видит все записи сущности. «Только свои» — видны только записи, где выбранное поле типа «Пользователь» равно текущему пользователю."}	2026-06-05 11:02:48.059497+00	2026-07-07 14:01:01.65+00
270	views.noSortsHint	{"en": "By default — by creation date (newest first).", "he": "כברירת מחדל — לפי תאריך יצירה (החדשים תחילה).", "ru": "По умолчанию — по дате создания (сначала новые)."}	2026-06-05 11:02:47.686765+00	2026-07-07 14:01:02.411+00
411	roles.superAdminDesc	{"en": "All permissions in all sections. Other settings are ignored.", "he": "כל ההרשאות בכל המקטעים. שאר ההגדרות מתעלמות.", "ru": "Все права во всех разделах. Остальные настройки игнорируются."}	2026-06-05 11:02:48.04366+00	2026-07-07 14:01:01.703+00
399	roles.deleteUsersError	{"en": "Cannot delete a role that has users", "he": "לא ניתן למחוק תפקיד עם משתמשים", "ru": "Нельзя удалить роль с пользователями"}	2026-06-05 11:02:48.016196+00	2026-07-07 14:01:01.59+00
456	records.noFieldsDesc	{"en": "First configure fields in the field builder — records cannot be created without them.", "he": "תחילה הגדר שדות בבונה השדות — לא ניתן ליצור רשומות בלעדיהם.", "ru": "Сначала настройте поля в конструкторе полей — без них нельзя создавать записи."}	2026-06-05 11:02:48.143129+00	2026-07-07 14:01:01.046+00
481	records.workflowHint	{"en": "Only transitions allowed by the process from the current status are available.", "he": "זמינים רק מעברים המותרים בתהליך מהסטטוס הנוכחי.", "ru": "Доступны только разрешённые процессом переходы из текущего статуса."}	2026-06-05 11:02:48.198288+00	2026-07-07 14:01:01.286+00
998	roles.cap.events	{"en": "Events", "he": "אירועים", "ru": "События"}	2026-06-05 14:15:58.586551+00	2026-07-07 14:01:01.452+00
437	roles.cap.translations	{"en": "Translations", "he": "תרגומים", "ru": "Переводы"}	2026-06-05 11:02:48.099888+00	2026-07-07 14:01:01.464+00
359	fields.dialogDesc	{"en": "A field is a data column of the entity with a type, required flag and default value.", "he": "שדה הוא עמודת נתונים של הישות עם סוג, חובה וערך ברירת מחדל.", "ru": "Поле — это столбец данных сущности с типом, обязательностью и значением по умолчанию."}	2026-06-05 11:02:47.866835+00	2026-07-07 14:00:58.267+00
999	events.title	{"en": "Events", "he": "אירועים", "ru": "События"}	2026-06-05 14:15:58.588915+00	2026-07-07 14:00:58.161+00
1009	events.pagination.total	{"en": "Total", "he": "סה\\"כ", "ru": "Всего"}	2026-06-05 14:15:58.614949+00	2026-07-07 14:00:58.152+00
1001	events.filter.all	{"en": "All events", "he": "כל האירועים", "ru": "Все события"}	2026-06-05 14:15:58.594078+00	2026-07-07 14:00:58.149+00
1003	events.col.time	{"en": "Time", "he": "זמן", "ru": "Время"}	2026-06-05 14:15:58.598661+00	2026-07-07 14:00:58.143+00
1008	events.col.payload	{"en": "Payload", "he": "נתונים", "ru": "Данные"}	2026-06-05 14:15:58.611887+00	2026-07-07 14:00:58.137+00
1000	events.subtitle	{"en": "System event log (foundation for automations)", "he": "יומן אירועי מערכת (בסיס לאוטומציות)", "ru": "Журнал системных событий (основа для автоматизаций)"}	2026-06-05 14:15:58.591202+00	2026-07-07 14:00:58.157+00
1005	events.col.entity	{"en": "Entity", "he": "ישות", "ru": "Сущность"}	2026-06-05 14:15:58.603974+00	2026-07-07 14:00:58.131+00
1006	events.col.record	{"en": "Record", "he": "רשומה", "ru": "Запись"}	2026-06-05 14:15:58.606378+00	2026-07-07 14:00:58.141+00
355	fields.no	{"en": "No", "he": "לא", "ru": "Нет"}	2026-06-05 11:02:47.859468+00	2026-07-07 14:00:58.986+00
2655	records.fileUpload	{"en": "Upload file", "he": "העלאת קובץ", "ru": "Загрузить файл"}	2026-06-07 12:47:46.516171+00	2026-07-07 14:01:00.714+00
2654	records.fileSource.link	{"en": "Link", "he": "קישור", "ru": "Ссылка"}	2026-06-07 12:47:46.514047+00	2026-07-07 14:01:00.706+00
2652	records.fileSource.server	{"en": "Server", "he": "שרת", "ru": "Сервер"}	2026-06-07 12:47:46.509028+00	2026-07-07 14:01:00.71+00
227	entities.fieldPage	{"en": "Display page", "he": "דף תצוגה", "ru": "Страница отображения"}	2026-06-05 11:02:47.597551+00	2026-07-07 14:00:58.058+00
1007	events.col.actor	{"en": "User", "he": "משתמש", "ru": "Пользователь"}	2026-06-05 14:15:58.60893+00	2026-07-07 14:00:58.127+00
268	views.value	{"en": "value", "he": "ערך", "ru": "значение"}	2026-06-05 11:02:47.68012+00	2026-07-07 14:01:02.527+00
1004	events.col.event	{"en": "Event", "he": "אירוע", "ru": "Событие"}	2026-06-05 14:15:58.600991+00	2026-07-07 14:00:58.134+00
2653	records.fileSource.gdrive	{"en": "Google Drive", "he": "Google Drive", "ru": "Google Drive"}	2026-06-07 12:47:46.511322+00	2026-07-07 14:01:00.699+00
2656	records.fileUploadError	{"en": "Failed to upload file", "he": "העלאת הקובץ נכשלה", "ru": "Не удалось загрузить файл"}	2026-06-07 12:47:46.519198+00	2026-07-07 14:01:00.717+00
442	records.loadError	{"en": "Error loading records", "he": "שגיאה בטעינת רשומות", "ru": "Ошибка загрузки записей"}	2026-06-05 11:02:48.112055+00	2026-07-07 14:01:00.98+00
1010	layout.impersonating	{"en": "You are signed in as", "he": "התחברת בתור", "ru": "Вы вошли как"}	2026-06-05 14:15:58.618349+00	2026-07-07 14:00:59.876+00
1002	events.empty	{"en": "No events yet", "he": "אין אירועים עדיין", "ru": "Событий пока нет"}	2026-06-05 14:15:58.596262+00	2026-07-07 14:00:58.147+00
312	workflow.newTransition	{"en": "New transition", "he": "מעבר חדש", "ru": "Новый переход"}	2026-06-05 11:02:47.773273+00	2026-07-07 14:01:02.619+00
1530	modules.name	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-05 14:36:24.457576+00	2026-07-07 14:01:00.102+00
1538	modules.settingsInvalid	{"en": "Settings must be a valid JSON object", "he": "ההגדרות חייבות להיות אובייקט JSON תקין", "ru": "Настройки должны быть корректным JSON-объектом"}	2026-06-05 14:36:24.477322+00	2026-07-07 14:01:00.121+00
1532	modules.keyImmutable	{"en": "The key cannot be changed after creation", "he": "לא ניתן לשנות את המפתח לאחר היצירה", "ru": "Ключ нельзя изменить после создания"}	2026-06-05 14:36:24.462752+00	2026-07-07 14:01:00.092+00
1523	modules.col.version	{"en": "Version", "he": "גרסה", "ru": "Версия"}	2026-06-05 14:36:24.429196+00	2026-07-07 14:01:00.028+00
1533	modules.keyInvalid	{"en": "Key: lowercase letters, digits, _; must start with a letter", "he": "מפתח: אותיות קטנות, ספרות, _; חייב להתחיל באות", "ru": "Ключ: строчные латинские буквы, цифры, _; начинается с буквы"}	2026-06-05 14:36:24.465251+00	2026-07-07 14:01:00.098+00
1527	modules.disabled	{"en": "Disabled", "he": "מושבת", "ru": "Выключен"}	2026-06-05 14:36:24.449243+00	2026-07-07 14:01:00.051+00
2659	records.fileDisplayName	{"en": "Display name", "he": "שם לתצוגה", "ru": "Отображаемое имя"}	2026-06-07 12:47:46.64668+00	2026-07-07 14:01:00.67+00
246	views.subtitle	{"en": "Saved record views: filters, sorting and search", "he": "תצוגות רשומות שמורות: סינון, מיון וחיפוש", "ru": "Сохранённые виды записей: фильтры, сортировка и поиск"}	2026-06-05 11:02:47.635727+00	2026-07-07 14:01:02.509+00
1539	modules.nameRequired	{"en": "Name is required", "he": "נדרש שם", "ru": "Укажите название"}	2026-06-05 14:36:24.479919+00	2026-07-07 14:01:00.106+00
1518	modules.subtitle	{"en": "Module registry — infrastructure for future plugins", "he": "מרשם מודולים — תשתית לתוספים עתידיים", "ru": "Реестр модулей — инфраструктура для будущих плагинов"}	2026-06-05 14:36:24.414725+00	2026-07-07 14:01:00.124+00
2658	records.fileRemove	{"en": "Remove file", "he": "הסרת קובץ", "ru": "Удалить файл"}	2026-06-07 12:47:46.642982+00	2026-07-07 14:01:00.676+00
1529	modules.editTitle	{"en": "Edit module", "he": "ערוך מודול", "ru": "Редактировать модуль"}	2026-06-05 14:36:24.45467+00	2026-07-07 14:01:00.054+00
1540	modules.created	{"en": "Module registered", "he": "המודול נרשם", "ru": "Модуль зарегистрирован"}	2026-06-05 14:36:24.482318+00	2026-07-07 14:01:00.031+00
1519	modules.add	{"en": "Add module", "he": "הוסף מודול", "ru": "Добавить модуль"}	2026-06-05 14:36:24.417256+00	2026-07-07 14:00:59.923+00
1526	modules.enabled	{"en": "Enabled", "he": "מופעל", "ru": "Включён"}	2026-06-05 14:36:24.446297+00	2026-07-07 14:01:00.068+00
1517	modules.title	{"en": "Modules", "he": "מודולים", "ru": "Модули"}	2026-06-05 14:36:24.411877+00	2026-07-07 14:01:00.128+00
1542	modules.updated	{"en": "Module updated", "he": "המודול עודכן", "ru": "Модуль обновлён"}	2026-06-05 14:36:24.486991+00	2026-07-07 14:01:00.132+00
313	workflow.dialogDescription	{"en": "A transition allows changing a record's status. You can restrict roles, require field completion, and define actions.", "he": "מעבר מאפשר לשנות את סטטוס הרשומה. ניתן להגביל תפקידים, לדרוש מילוי שדות ולהגדיר פעולות.", "ru": "Переход разрешает смену статуса записи. Можно ограничить роли, потребовать заполнения полей и задать действия."}	2026-06-05 11:02:47.775213+00	2026-07-07 14:01:02.594+00
1536	modules.enableDesc	{"en": "Enabled modules are available to the platform", "he": "מודולים מופעלים זמינים לפלטפורמה", "ru": "Активные модули доступны платформе"}	2026-06-05 14:36:24.472727+00	2026-07-07 14:01:00.072+00
1525	modules.col.actions	{"en": "Actions", "he": "פעולות", "ru": "Действия"}	2026-06-05 14:36:24.443209+00	2026-07-07 14:01:00.015+00
1528	modules.newTitle	{"en": "New module", "he": "מודול חדש", "ru": "Новый модуль"}	2026-06-05 14:36:24.452136+00	2026-07-07 14:01:00.11+00
1543	modules.updateError	{"en": "Failed to update module", "he": "עדכון המודול נכשל", "ru": "Ошибка обновления модуля"}	2026-06-05 14:36:24.489359+00	2026-07-07 14:01:00.135+00
2657	records.fileReplace	{"en": "Replace file", "he": "החלפת קובץ", "ru": "Заменить файл"}	2026-06-07 12:47:46.521681+00	2026-07-07 14:01:00.695+00
1531	modules.key	{"en": "System key", "he": "מפתח מערכת", "ru": "Системный ключ"}	2026-06-05 14:36:24.46033+00	2026-07-07 14:01:00.076+00
1522	modules.col.key	{"en": "Key", "he": "מפתח", "ru": "Ключ"}	2026-06-05 14:36:24.425339+00	2026-07-07 14:01:00.018+00
1541	modules.createError	{"en": "Failed to register module", "he": "רישום המודול נכשל", "ru": "Ошибка регистрации модуля"}	2026-06-05 14:36:24.484647+00	2026-07-07 14:01:00.035+00
1520	modules.empty	{"en": "No modules yet", "he": "אין מודולים עדיין", "ru": "Модулей пока нет"}	2026-06-05 14:36:24.42019+00	2026-07-07 14:01:00.062+00
1537	modules.settings	{"en": "Settings (JSON)", "he": "הגדרות (JSON)", "ru": "Настройки (JSON)"}	2026-06-05 14:36:24.475037+00	2026-07-07 14:01:00.117+00
1534	modules.version	{"en": "Version", "he": "גרסה", "ru": "Версия"}	2026-06-05 14:36:24.467823+00	2026-07-07 14:01:00.139+00
1544	modules.deleted	{"en": "Module deleted", "he": "המודול נמחק", "ru": "Модуль удалён"}	2026-06-05 14:36:24.491819+00	2026-07-07 14:01:00.037+00
1521	modules.col.name	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-05 14:36:24.422862+00	2026-07-07 14:01:00.022+00
1535	modules.enable	{"en": "Enabled", "he": "מופעל", "ru": "Включён"}	2026-06-05 14:36:24.47033+00	2026-07-07 14:01:00.065+00
2752	users.linkCreated	{"en": "Created", "he": "נוצר", "ru": "Создана"}	2026-06-07 12:47:46.902898+00	2026-07-07 14:01:02.192+00
1524	modules.col.status	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-06-05 14:36:24.43821+00	2026-07-07 14:01:00.025+00
2101	records.clickToEdit	{"en": "Click to edit", "he": "לחצו לעריכה", "ru": "Нажмите, чтобы изменить"}	2026-06-05 16:30:54.28946+00	2026-07-07 14:01:00.516+00
2097	records.configureColumn	{"en": "Configure column", "he": "הגדרת עמודה", "ru": "Настроить колонку"}	2026-06-05 16:30:54.278926+00	2026-07-07 14:01:00.53+00
2093	records.filterClearField	{"en": "Clear", "he": "ניקוי", "ru": "Очистить"}	2026-06-05 16:30:54.266658+00	2026-07-07 14:01:00.731+00
2111	orders.create	{"en": "New order", "he": "הזמנה חדשה", "ru": "Новый заказ"}	2026-06-05 19:59:41.849575+00	2026-06-05 19:59:41.849575+00
2112	peripro.test.dupe.1780689646589	{"en": "A", "he": "א", "ru": "А"}	2026-06-05 20:00:46.594584+00	2026-06-05 20:00:46.594584+00
2089	common.yes	{"en": "Yes", "he": "כן", "ru": "Да"}	2026-06-05 16:30:54.256464+00	2026-07-07 14:00:57.198+00
2650	fields.fileSources	{"en": "File sources", "he": "מקורות קבצים", "ru": "Источники файлов"}	2026-06-07 12:47:46.503735+00	2026-07-07 14:00:58.312+00
2651	fields.fileSourcesHint	{"en": "Which ways to add a file are available when filling in (at least one required)", "he": "אילו דרכים להוספת קובץ זמינות בעת המילוי (נדרשת לפחות אחת)", "ru": "Какие способы добавления файла доступны при заполнении (нужен хотя бы один)"}	2026-06-07 12:47:46.506375+00	2026-07-07 14:00:58.316+00
2092	records.filterNoValues	{"en": "No values", "he": "אין ערכים", "ru": "Нет значений"}	2026-06-05 16:30:54.264088+00	2026-07-07 14:01:00.736+00
2095	records.filterReset	{"en": "Reset filters", "he": "איפוס מסננים", "ru": "Сбросить фильтры"}	2026-06-05 16:30:54.272256+00	2026-07-07 14:01:00.739+00
2102	fields.filterable	{"en": "Filterable", "he": "משתתף בסינון", "ru": "Участвует в фильтре"}	2026-06-05 16:30:54.292022+00	2026-07-07 14:00:58.493+00
2091	records.filterSearchValues	{"en": "Search values…", "he": "חיפוש ערכים…", "ru": "Поиск значений…"}	2026-06-05 16:30:54.261447+00	2026-07-07 14:01:00.933+00
2099	records.saveRow	{"en": "Save row", "he": "שמירת השורה", "ru": "Сохранить строку"}	2026-06-05 16:30:54.284241+00	2026-07-07 14:01:01.088+00
2096	records.setupHint	{"en": "Setup mode is on. Click a column header to edit its properties and permissions, or «+» to add a new column.", "he": "מצב הגדרה פעיל. לחצו על כותרת עמודה כדי לערוך את מאפייניה והרשאותיה, או על «+» כדי להוסיף עמודה חדשה.", "ru": "Режим настройки включён. Нажмите на заголовок колонки, чтобы изменить её свойства и права, или «+», чтобы добавить новую колонку."}	2026-06-05 16:30:54.274781+00	2026-07-07 14:01:01.103+00
1547	modules.deleteDesc	{"en": "This action cannot be undone.", "he": "לא ניתן לבטל פעולה זו.", "ru": "Это действие нельзя отменить."}	2026-06-05 14:36:24.499319+00	2026-07-07 14:01:00.041+00
2094	records.setupMode	{"en": "Setup mode", "he": "מצב הגדרה", "ru": "Режим настройки"}	2026-06-05 16:30:54.269218+00	2026-07-07 14:01:01.106+00
1545	modules.deleteError	{"en": "Failed to delete module", "he": "מחיקת המודול נכשלה", "ru": "Ошибка удаления модуля"}	2026-06-05 14:36:24.494211+00	2026-07-07 14:01:00.044+00
1546	modules.deleteTitle	{"en": "Delete module?", "he": "למחוק את המודול?", "ru": "Удалить модуль?"}	2026-06-05 14:36:24.497011+00	2026-07-07 14:01:00.047+00
29	page.emptyDesc	{"en": "No entity is linked to this page yet. Create an entity in the builder and select this page to display it.", "he": "עדיין לא משויכת ישות לדף זה. צור ישות בבונה ובחר דף זה לתצוגה.", "ru": "К этой странице ещё не привязана сущность. Создайте сущность в конструкторе и выберите эту страницу для отображения."}	2026-06-05 11:02:47.173653+00	2026-07-07 14:01:00.149+00
2098	records.addColumn	{"en": "Column", "he": "עמודה", "ru": "Колонка"}	2026-06-05 16:30:54.282013+00	2026-07-07 14:01:00.479+00
1013	users.impersonateError	{"en": "Failed to sign in as user", "he": "הכניסה בתור המשתמש נכשלה", "ru": "Не удалось войти под пользователем"}	2026-06-05 14:15:58.626442+00	2026-07-07 14:01:02.181+00
2100	records.addRow	{"en": "Add row", "he": "הוספת שורה", "ru": "Добавить строку"}	2026-06-05 16:30:54.286949+00	2026-07-07 14:01:00.484+00
2090	common.no	{"en": "No", "he": "לא", "ru": "Нет"}	2026-06-05 16:30:54.258949+00	2026-07-07 14:00:57.19+00
2687	gdrive.saveError	{"en": "Failed to save settings", "he": "שמירת ההגדרות נכשלה", "ru": "Ошибка сохранения настроек"}	2026-06-07 12:47:46.731228+00	2026-07-07 14:00:59.618+00
2662	records.driveReplace	{"en": "Replace in Google Drive", "he": "החלפה ב-Google Drive", "ru": "Заменить в Google Drive"}	2026-06-07 12:47:46.654398+00	2026-07-07 14:01:00.645+00
2670	gdrive.account	{"en": "Account", "he": "חשבון", "ru": "Аккаунт"}	2026-06-07 12:47:46.675455+00	2026-07-07 14:00:59.336+00
2674	gdrive.modeOwn	{"en": "Own", "he": "משלך", "ru": "Собственные"}	2026-06-07 12:47:46.685986+00	2026-07-07 14:00:59.597+00
2684	gdrive.secretStored	{"en": "•••••• (stored, leave empty to keep)", "he": "•••••• (שמור, השאירו ריק כדי לא לשנות)", "ru": "•••••• (сохранён, оставьте пустым чтобы не менять)"}	2026-06-07 12:47:46.722512+00	2026-07-07 14:00:59.621+00
2688	gdrive.startError	{"en": "Failed to start connection", "he": "פתיחת החיבור נכשלה", "ru": "Не удалось начать подключение"}	2026-06-07 12:47:46.733597+00	2026-07-07 14:00:59.624+00
2667	gdrive.statusConnected	{"en": "Connected", "he": "מחובר", "ru": "Подключено"}	2026-06-07 12:47:46.667441+00	2026-07-07 14:00:59.628+00
2677	gdrive.reconnect	{"en": "Reconnect", "he": "חיבור מחדש", "ru": "Переподключить"}	2026-06-07 12:47:46.694523+00	2026-07-07 14:00:59.609+00
2691	gdrive.disconnected	{"en": "Google Drive disconnected", "he": "Google Drive נותק", "ru": "Google Drive отключён"}	2026-06-07 12:47:46.742275+00	2026-07-07 14:00:59.435+00
2693	gdrive.disconnectConfirmTitle	{"en": "Disconnect Google Drive?", "he": "לנתק את Google Drive?", "ru": "Отключить Google Drive?"}	2026-06-07 12:47:46.747527+00	2026-07-07 14:00:59.432+00
2695	gdrive.copied	{"en": "Copied", "he": "הועתק", "ru": "Скопировано"}	2026-06-07 12:47:46.752829+00	2026-07-07 14:00:59.414+00
2689	gdrive.connectedToast	{"en": "Google Drive connected", "he": "Google Drive חובר", "ru": "Google Drive подключён"}	2026-06-07 12:47:46.736606+00	2026-07-07 14:00:59.407+00
2681	gdrive.credsTitle	{"en": "OAuth keys", "he": "מפתחות OAuth", "ru": "Ключи OAuth"}	2026-06-07 12:47:46.705167+00	2026-07-07 14:00:59.42+00
2676	gdrive.connect	{"en": "Connect Google Drive", "he": "חיבור Google Drive", "ru": "Подключить Google Drive"}	2026-06-07 12:47:46.691652+00	2026-07-07 14:00:59.404+00
2680	gdrive.builtinUnavailable	{"en": "Built-in keys are not configured (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET) — switch to \\"Own\\"", "he": "המפתחות המובנים אינם מוגדרים (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET) — עברו ל«משלך»", "ru": "Встроенные ключи не настроены (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET) — переключитесь на «Собственные»"}	2026-06-07 12:47:46.701895+00	2026-07-07 14:00:59.394+00
2682	gdrive.clientId	{"en": "Client ID", "he": "Client ID", "ru": "Client ID"}	2026-06-07 12:47:46.715123+00	2026-07-07 14:00:59.398+00
2692	gdrive.disconnectError	{"en": "Failed to disconnect", "he": "הניתוק נכשל", "ru": "Ошибка отключения"}	2026-06-07 12:47:46.744716+00	2026-07-07 14:00:59.544+00
2669	gdrive.statusTitle	{"en": "Connection status", "he": "מצב החיבור", "ru": "Состояние подключения"}	2026-06-07 12:47:46.673047+00	2026-07-07 14:00:59.77+00
2666	gdrive.subtitle	{"en": "Connect Google Drive to upload files in file-type fields", "he": "חברו את Google Drive להעלאת קבצים בשדות מסוג «קובץ»", "ru": "Подключите Google Drive для загрузки файлов в полях типа «файл»"}	2026-06-07 12:47:46.664822+00	2026-07-07 14:00:59.812+00
2671	gdrive.folder	{"en": "Uploads folder", "he": "תיקיית העלאות", "ru": "Папка загрузок"}	2026-06-07 12:47:46.6784+00	2026-07-07 14:00:59.547+00
2661	records.driveUpload	{"en": "Upload to Google Drive", "he": "העלאה ל-Google Drive", "ru": "Загрузить в Google Drive"}	2026-06-07 12:47:46.651994+00	2026-07-07 14:01:00.647+00
2663	records.driveUploadError	{"en": "Failed to upload to Google Drive", "he": "ההעלאה ל-Google Drive נכשלה", "ru": "Не удалось загрузить в Google Drive"}	2026-06-07 12:47:46.657238+00	2026-07-07 14:01:00.65+00
2672	gdrive.mode	{"en": "Key mode", "he": "מצב מפתחות", "ru": "Режим ключей"}	2026-06-07 12:47:46.680917+00	2026-07-07 14:00:59.59+00
2686	gdrive.saved	{"en": "Settings saved", "he": "ההגדרות נשמרו", "ru": "Настройки сохранены"}	2026-06-07 12:47:46.728236+00	2026-07-07 14:00:59.615+00
2665	gdrive.title	{"en": "Google Drive", "he": "Google Drive", "ru": "Google Drive"}	2026-06-07 12:47:46.662457+00	2026-07-07 14:00:59.816+00
2690	gdrive.connectError	{"en": "Failed to connect Google Drive", "he": "חיבור Google Drive נכשל", "ru": "Не удалось подключить Google Drive"}	2026-06-07 12:47:46.739319+00	2026-07-07 14:00:59.411+00
2696	gdrive.copyError	{"en": "Failed to copy", "he": "ההעתקה נכשלה", "ru": "Не удалось скопировать"}	2026-06-07 12:47:46.75569+00	2026-07-07 14:00:59.417+00
2697	gdrive.builtinReady	{"en": "Using the platform's built-in keys. Click \\"Save\\", then connect Google Drive.", "he": "נעשה שימוש במפתחות המובנים של הפלטפורמה. לחצו «שמירה» ואז חברו את Google Drive.", "ru": "Используются встроенные ключи платформы. Нажмите «Сохранить», затем подключите Google Drive."}	2026-06-07 12:47:46.758317+00	2026-07-07 14:00:59.39+00
2678	gdrive.disconnect	{"en": "Disconnect", "he": "ניתוק", "ru": "Отключить"}	2026-06-07 12:47:46.696853+00	2026-07-07 14:00:59.424+00
2673	gdrive.modeBuiltin	{"en": "Built-in", "he": "מובנים", "ru": "Встроенные"}	2026-06-07 12:47:46.683539+00	2026-07-07 14:00:59.594+00
2679	gdrive.needCreds	{"en": "First save the Client ID and Client Secret below", "he": "תחילה שמרו את ה-Client ID וה-Client Secret למטה", "ru": "Сначала сохраните Client ID и Client Secret ниже"}	2026-06-07 12:47:46.699602+00	2026-07-07 14:00:59.602+00
2683	gdrive.clientSecret	{"en": "Client Secret", "he": "Client Secret", "ru": "Client Secret"}	2026-06-07 12:47:46.719653+00	2026-07-07 14:00:59.401+00
2685	gdrive.save	{"en": "Save", "he": "שמירה", "ru": "Сохранить"}	2026-06-07 12:47:46.725782+00	2026-07-07 14:00:59.612+00
2668	gdrive.statusDisconnected	{"en": "Not connected", "he": "לא מחובר", "ru": "Не подключено"}	2026-06-07 12:47:46.67012+00	2026-07-07 14:00:59.631+00
2675	gdrive.unavailable	{"en": "unavailable", "he": "לא זמין", "ru": "недоступно"}	2026-06-07 12:47:46.689135+00	2026-07-07 14:00:59.82+00
2741	users.guestLinks	{"en": "Guest links", "he": "קישורי אורח", "ru": "Гостевые ссылки"}	2026-06-07 12:47:46.874363+00	2026-07-07 14:01:02.079+00
2746	users.linkLabel	{"en": "Label (optional)", "he": "תווית (אופציונלי)", "ru": "Название (необязательно)"}	2026-06-07 12:47:46.887066+00	2026-07-07 14:01:02.204+00
2734	views.reorderError	{"en": "Failed to reorder", "he": "שגיאה בשינוי הסדר", "ru": "Ошибка изменения порядка"}	2026-06-07 12:47:46.855968+00	2026-07-07 14:01:02.462+00
2735	workflow.reorderError	{"en": "Failed to reorder", "he": "שגיאה בשינוי הסדר", "ru": "Ошибка изменения порядка"}	2026-06-07 12:47:46.859633+00	2026-07-07 14:01:02.638+00
2732	fields.reorderError	{"en": "Failed to reorder", "he": "שגיאה בשינוי הסדר", "ru": "Ошибка изменения порядка"}	2026-06-07 12:47:46.850534+00	2026-07-07 14:00:59.045+00
2700	gdrive.step1	{"en": "Open", "he": "פתחו", "ru": "Откройте"}	2026-06-07 12:47:46.766066+00	2026-07-07 14:00:59.775+00
2705	gdrive.step4	{"en": "In", "he": "בקטע", "ru": "В разделе"}	2026-06-07 12:47:46.779439+00	2026-07-07 14:00:59.793+00
2701	gdrive.step1b	{"en": "and create a project.", "he": "וצרו פרויקט.", "ru": "и создайте проект."}	2026-06-07 12:47:46.768972+00	2026-07-07 14:00:59.78+00
2706	gdrive.step4b	{"en": "create an \\"OAuth client ID\\" → type \\"Web application\\".", "he": "צרו «OAuth client ID» ← סוג «Web application».", "ru": "создайте «OAuth client ID» → тип «Web application»."}	2026-06-07 12:47:46.781892+00	2026-07-07 14:00:59.796+00
2702	gdrive.step2	{"en": "Enable", "he": "הפעילו", "ru": "Включите"}	2026-06-07 12:47:46.771397+00	2026-07-07 14:00:59.783+00
2707	gdrive.step5	{"en": "Add this Redirect URI:", "he": "הוסיפו את ה-Redirect URI הזה:", "ru": "Добавьте этот Redirect URI:"}	2026-06-07 12:47:46.784779+00	2026-07-07 14:00:59.799+00
2708	gdrive.step6	{"en": "Copy the Client ID and Client Secret into the fields below and save.", "he": "העתיקו את ה-Client ID וה-Client Secret לשדות למטה ושמרו.", "ru": "Скопируйте Client ID и Client Secret в поля ниже и сохраните."}	2026-06-07 12:47:46.787259+00	2026-07-07 14:00:59.802+00
2699	gdrive.wizardTitle	{"en": "How to get keys (free Gmail account)", "he": "כיצד להשיג מפתחות (חשבון Gmail חינמי)", "ru": "Как получить ключи (бесплатный аккаунт Gmail)"}	2026-06-07 12:47:46.763706+00	2026-07-07 14:00:59.824+00
2728	layout.collapseSidebar	{"en": "Collapse menu", "he": "כיווץ התפריט", "ru": "Свернуть меню"}	2026-06-07 12:47:46.840065+00	2026-07-07 14:00:59.847+00
2727	layout.expandSidebar	{"en": "Expand menu", "he": "הרחבת התפריט", "ru": "Развернуть меню"}	2026-06-07 12:47:46.837563+00	2026-07-07 14:00:59.854+00
2718	records.moveColumnLeft	{"en": "Move left", "he": "הזזה שמאלה", "ru": "Левее"}	2026-06-07 12:47:46.813898+00	2026-07-07 14:01:01.005+00
2719	records.moveColumnRight	{"en": "Move right", "he": "הזזה ימינה", "ru": "Правее"}	2026-06-07 12:47:46.816613+00	2026-07-07 14:01:01.008+00
2714	records.reorderColumnError	{"en": "Failed to reorder columns", "he": "שגיאה בשינוי סדר העמודות", "ru": "Ошибка изменения порядка колонок"}	2026-06-07 12:47:46.802916+00	2026-07-07 14:01:01.073+00
2744	users.guestLinksTitle	{"en": "Guest links", "he": "קישורי אורח", "ru": "Гостевые ссылки"}	2026-06-07 12:47:46.881888+00	2026-07-07 14:01:02.081+00
2742	users.guestUser	{"en": "Guest access (passwordless)", "he": "גישת אורח (ללא סיסמה)", "ru": "Гостевой доступ (без пароля)"}	2026-06-07 12:47:46.876616+00	2026-07-07 14:01:02.085+00
2747	users.linkLabelPlaceholder	{"en": "e.g. Client Ivanov", "he": "לדוגמה: לקוח איבנוב", "ru": "Напр. Клиент Иванов"}	2026-06-07 12:47:46.890056+00	2026-07-07 14:01:02.207+00
2745	users.linkRevoked	{"en": "Link revoked", "he": "הקישור בוטל", "ru": "Ссылка отозвана"}	2026-06-07 12:47:46.884742+00	2026-07-07 14:01:02.213+00
2750	users.noLinks	{"en": "No links yet", "he": "אין קישורים עדיין", "ru": "Ссылок пока нет"}	2026-06-07 12:47:46.897817+00	2026-07-07 14:01:02.225+00
2726	fields.showInTable	{"en": "Show in table", "he": "הצג בטבלה", "ru": "Показывать в таблице"}	2026-06-07 12:47:46.834774+00	2026-07-07 14:00:59.089+00
2703	gdrive.step3	{"en": "In", "he": "בקטע", "ru": "В разделе"}	2026-06-07 12:47:46.774182+00	2026-07-07 14:00:59.787+00
2729	layout.guestMode	{"en": "Guest access — read-only mode", "he": "גישת אורח — מצב קריאה בלבד", "ru": "Гостевой доступ — режим только для чтения"}	2026-06-07 12:47:46.842946+00	2026-07-07 14:00:59.861+00
2733	statuses.reorderError	{"en": "Failed to reorder", "he": "שגיאה בשינוי הסדר", "ru": "Ошибка изменения порядка"}	2026-06-07 12:47:46.853172+00	2026-07-07 14:01:01.973+00
1012	users.impersonate	{"en": "Sign in as user", "he": "כניסה בתור המשתמש", "ru": "Войти под пользователем"}	2026-06-05 14:15:58.623442+00	2026-07-07 14:01:02.091+00
2749	users.linkCreatedHint	{"en": "Copy the link now — it won't be shown later:", "he": "העתיקו את הקישור עכשיו — הוא לא יוצג שוב מאוחר יותר:", "ru": "Скопируйте ссылку сейчас — позже она не будет показана:"}	2026-06-07 12:47:46.895305+00	2026-07-07 14:01:02.195+00
2751	users.unnamedLink	{"en": "Untitled", "he": "ללא שם", "ru": "Без названия"}	2026-06-07 12:47:46.90053+00	2026-07-07 14:01:02.27+00
2704	gdrive.step3b	{"en": "choose \\"External\\" and add yourself to Test users.", "he": "בחרו «External» והוסיפו את עצמכם ל-Test users.", "ru": "выберите «External», добавьте себя в Test users."}	2026-06-07 12:47:46.776616+00	2026-07-07 14:00:59.79+00
2748	users.generateLink	{"en": "Create link", "he": "יצירת קישור", "ru": "Создать ссылку"}	2026-06-07 12:47:46.892432+00	2026-07-07 14:01:02.077+00
4588	fields.fileSource.gdrive	{"en": "Upload to Google Drive", "he": "העלאה ל-Google Drive", "ru": "Загрузка в Google Drive"}	2026-06-07 13:45:17.099914+00	2026-07-07 14:00:58.302+00
16039	dash.chartWidget	{"en": "Chart", "he": "תרשים", "ru": "График"}	2026-06-07 21:39:24.471382+00	2026-07-07 14:00:57.257+00
4589	fields.fileSource.link	{"en": "Link", "he": "קישור", "ru": "Ссылка"}	2026-06-07 13:45:17.102145+00	2026-07-07 14:00:58.305+00
5696	fields.keyTaken	{"en": "A field with this system key already exists in this entity.", "he": "שדה עם מפתח מערכתי זה כבר קיים בישות זו.", "ru": "Поле с таким системным ключом уже существует в этой сущности."}	2026-06-07 14:01:27.867777+00	2026-07-07 14:00:58.973+00
3266	modules.openSettings	{"en": "Settings", "he": "הגדרות", "ru": "Настройки"}	2026-06-07 13:22:40.204156+00	2026-07-07 14:01:00.114+00
2754	users.linkExpires	{"en": "Expires", "he": "פג בתאריך", "ru": "Истекает"}	2026-06-07 12:47:46.908231+00	2026-07-07 14:01:02.2+00
90	statuses.empty	{"en": "This entity has no statuses yet. Click \\"Add status\\" to create the first one.", "he": "לישות זו אין עדיין סטטוסים. לחץ על \\"הוסף סטטוס\\" כדי ליצור את הראשון.", "ru": "У этой сущности ещё нет статусов. Нажмите «Добавить статус», чтобы создать первый."}	2026-06-05 11:02:47.306101+00	2026-07-07 14:01:01.949+00
10016	fields.rowColor	{"en": "Row", "he": "שורה", "ru": "Строка"}	2026-06-07 16:48:22.120529+00	2026-07-07 14:00:59.054+00
2694	gdrive.disconnectConfirm	{"en": "The access token will be removed. Already uploaded files stay in Google Drive, but new uploads will be unavailable until you reconnect.", "he": "אסימון הגישה יוסר. קבצים שכבר הועלו יישארו ב-Google Drive, אך העלאות חדשות לא יהיו זמינות עד לחיבור מחדש.", "ru": "Токен доступа будет удалён. Уже загруженные файлы останутся в Google Drive, но новые загрузки станут недоступны до повторного подключения."}	2026-06-07 12:47:46.749758+00	2026-07-07 14:00:59.428+00
2664	records.driveNotConnected	{"en": "Google Drive is not connected. Connect it in settings.", "he": "Google Drive אינו מחובר. חברו אותו בהגדרות.", "ru": "Google Drive не подключён. Подключите его в настройках."}	2026-06-07 12:47:46.659437+00	2026-07-07 14:01:00.641+00
2755	users.linkActive	{"en": "Active", "he": "פעיל", "ru": "Активна"}	2026-06-07 12:47:46.911113+00	2026-07-07 14:01:02.19+00
2753	users.linkLastUsed	{"en": "Used", "he": "נעשה שימוש", "ru": "Использована"}	2026-06-07 12:47:46.905797+00	2026-07-07 14:01:02.21+00
16041	dash.gridH	{"en": "Height (cells)", "he": "גובה (תאים)", "ru": "Высота (ячеек)"}	2026-06-07 21:39:24.475749+00	2026-07-07 14:00:57.349+00
3911	modules.backToList	{"en": "Back to modules", "he": "חזרה למודולים", "ru": "К списку модулей"}	2026-06-07 13:38:55.269423+00	2026-07-07 14:01:00.012+00
4587	fields.fileSource.server	{"en": "Upload to server", "he": "העלאה לשרת", "ru": "Загрузка на сервер"}	2026-06-07 13:45:17.096949+00	2026-07-07 14:00:58.309+00
4423	fields.type.file	{"en": "File", "he": "קובץ", "ru": "Файл"}	2026-06-07 13:45:16.653726+00	2026-07-07 14:00:59.147+00
2660	records.filePreviewError	{"en": "Failed to load preview", "he": "טעינת התצוגה המקדימה נכשלה", "ru": "Не удалось загрузить предпросмотр"}	2026-06-07 12:47:46.649194+00	2026-07-07 14:01:00.673+00
16040	dash.gridW	{"en": "Width (cells)", "he": "רוחב (תאים)", "ru": "Ширина (ячеек)"}	2026-06-07 21:39:24.473676+00	2026-07-07 14:00:57.356+00
2756	users.linkRevokedBadge	{"en": "Revoked", "he": "בוטל", "ru": "Отозвана"}	2026-06-07 12:47:46.913499+00	2026-07-07 14:01:02.216+00
2757	users.linkExpired	{"en": "Expired", "he": "פג תוקף", "ru": "Истекла"}	2026-06-07 12:47:46.916285+00	2026-07-07 14:01:02.198+00
5697	fields.keyAutoHint	{"en": "If left empty, the key will be generated automatically from the name:", "he": "אם יישאר ריק, המפתח ייווצר אוטומטית מהשם:", "ru": "Если оставить пустым, ключ будет сгенерирован автоматически из названия:"}	2026-06-07 14:01:27.869845+00	2026-07-07 14:00:58.96+00
6320	fields.userRoles	{"en": "Allowed user roles", "he": "תפקידי משתמש מורשים", "ru": "Доступные роли пользователей"}	2026-06-07 14:26:31.157086+00	2026-07-07 14:00:59.233+00
2758	users.revokeLink	{"en": "Revoke", "he": "ביטול", "ru": "Отозвать"}	2026-06-07 12:47:46.918431+00	2026-07-07 14:01:02.244+00
16038	dash.typeChart	{"en": "Chart", "he": "תרשים", "ru": "График"}	2026-06-07 21:39:24.469476+00	2026-07-07 14:00:57.778+00
301	workflow.subtitle	{"en": "Allowed transitions between statuses. While there are no transitions, the status can be changed freely.", "he": "מעברים מותרים בין סטטוסים. כל עוד אין מעברים, ניתן לשנות את הסטטוס בחופשיות.", "ru": "Разрешённые переходы между статусами. Пока переходов нет — статус можно менять свободно."}	2026-06-05 11:02:47.750715+00	2026-07-07 14:01:02.668+00
16037	dash.typeMetric	{"en": "Metric", "he": "מדד", "ru": "Показатель"}	2026-06-07 21:39:24.467095+00	2026-07-07 14:00:57.78+00
371	fields.accessHint	{"en": "\\"Default\\" — the field inherits the role's record permissions (edit ⇒ editing, otherwise view). Superadmins see and edit everything.", "he": "«ברירת מחדל» — השדה יורש את הרשאות התפקיד על הרשומות (עריכה ⇒ עריכה, אחרת צפייה). מנהלי-על רואים ועורכים הכול.", "ru": "«По умолчанию» — поле наследует права роли на записи (изменение ⇒ редактирование, иначе просмотр). Суперадмины видят и редактируют всё."}	2026-06-05 11:02:47.890196+00	2026-07-07 14:00:58.192+00
8055	pages.mirrorNone	{"en": "— Regular page —", "he": "— דף רגיל —", "ru": "— Обычная страница —"}	2026-06-07 15:29:55.04209+00	2026-07-07 14:01:00.322+00
7146	records.manageEntity	{"en": "Manage entity", "he": "ניהול ישות", "ru": "Управление сущностью"}	2026-06-07 14:48:15.240813+00	2026-07-07 14:01:00.983+00
7147	records.manageFields	{"en": "Fields", "he": "שדות", "ru": "Поля"}	2026-06-07 14:48:15.243316+00	2026-07-07 14:01:00.986+00
7151	records.manageProcesses	{"en": "Processes", "he": "תהליכים", "ru": "Процессы"}	2026-06-07 14:48:15.250987+00	2026-07-07 14:01:00.989+00
7149	records.manageRelations	{"en": "Relations", "he": "קשרים", "ru": "Связи"}	2026-06-07 14:48:15.246877+00	2026-07-07 14:01:00.996+00
7148	records.manageStatuses	{"en": "Statuses", "he": "סטטוסים", "ru": "Статусы"}	2026-06-07 14:48:15.245102+00	2026-07-07 14:01:00.998+00
7942	entities.manage	{"en": "Manage", "he": "הגדרה", "ru": "Настройка"}	2026-06-07 15:16:22.747303+00	2026-07-07 14:00:58.074+00
6321	fields.userRolesHint	{"en": "Restrict selection to users with these roles. If none are selected, all users are available.", "he": "הגבל את הבחירה למשתמשים עם תפקידים אלה. אם לא נבחר דבר — כל המשתמשים זמינים.", "ru": "Ограничьте выбор пользователями указанных ролей. Если ничего не выбрано — доступны все пользователи."}	2026-06-07 14:26:31.159839+00	2026-07-07 14:00:59.236+00
7945	iconPicker.clear	{"en": "Clear", "he": "נקה", "ru": "Очистить"}	2026-06-07 15:16:22.754404+00	2026-07-07 14:00:59.828+00
7946	iconPicker.empty	{"en": "Nothing found", "he": "לא נמצא דבר", "ru": "Ничего не найдено"}	2026-06-07 15:16:22.756608+00	2026-07-07 14:00:59.831+00
7943	iconPicker.placeholder	{"en": "Select an icon", "he": "בחרו סמל", "ru": "Выберите иконку"}	2026-06-07 15:16:22.750054+00	2026-07-07 14:00:59.84+00
7944	iconPicker.search	{"en": "Search icon…", "he": "חיפוש סמל…", "ru": "Поиск иконки…"}	2026-06-07 15:16:22.752271+00	2026-07-07 14:00:59.843+00
8054	pages.mirrorEntity	{"en": "Linked entity (live data)", "he": "ישות מקושרת (נתונים חיים)", "ru": "Связанная сущность (живые данные)"}	2026-06-07 15:29:55.037487+00	2026-07-07 14:01:00.305+00
8056	pages.mirrorHint	{"en": "The page will show the live records of the selected entity. Edits flow both ways; row and field visibility is governed by the role's permissions.", "he": "הדף יציג את הרשומות החיות של הישות שנבחרה. עריכות זורמות לשני הכיוונים; נראות שורות ושדות נקבעת לפי הרשאות התפקיד.", "ru": "Страница покажет живые записи выбранной сущности. Изменения двусторонние; видимость строк и полей определяется правами роли."}	2026-06-07 15:29:55.044761+00	2026-07-07 14:01:00.313+00
7150	records.manageViews	{"en": "Views", "he": "תצוגות", "ru": "Виды"}	2026-06-07 14:48:15.248714+00	2026-07-07 14:01:01.002+00
6323	records.userNotFound	{"en": "No users found", "he": "לא נמצאו משתמשים", "ru": "Пользователи не найдены"}	2026-06-07 14:26:31.165831+00	2026-07-07 14:01:01.271+00
6322	records.userSearch	{"en": "Search user...", "he": "חיפוש משתמש...", "ru": "Поиск пользователя..."}	2026-06-07 14:26:31.163611+00	2026-07-07 14:01:01.275+00
6954	workflow.anyStatus	{"en": "Any status", "he": "כל סטטוס", "ru": "Любой статус"}	2026-06-07 14:48:14.823998+00	2026-07-07 14:01:02.539+00
6956	workflow.manual	{"en": "Manual", "he": "ידני", "ru": "Вручную"}	2026-06-07 14:48:14.828002+00	2026-07-07 14:01:02.61+00
6957	workflow.manualHint	{"en": "Enter the value manually", "he": "הזינו את הערך ידנית", "ru": "Ввести значение вручную"}	2026-06-07 14:48:14.829871+00	2026-07-07 14:01:02.613+00
6960	workflow.no	{"en": "No", "he": "לא", "ru": "Нет"}	2026-06-07 14:48:14.836915+00	2026-07-07 14:01:02.622+00
6958	workflow.selectUser	{"en": "User", "he": "משתמש", "ru": "Пользователь"}	2026-06-07 14:48:14.832332+00	2026-07-07 14:01:02.658+00
6959	workflow.yes	{"en": "Yes", "he": "כן", "ru": "Да"}	2026-06-07 14:48:14.834319+00	2026-07-07 14:01:02.699+00
10001	pageFields.fillAfterCreate	{"en": "Filled after the record is created", "he": "ממולא לאחר יצירת הרשומה", "ru": "Заполняется после создания записи"}	2026-06-07 16:48:22.086616+00	2026-07-07 14:01:00.171+00
8888	entities.keyAutoPlaceholder	{"en": "Generated automatically", "he": "ייווצר אוטומטית", "ru": "Сгенерируется автоматически"}	2026-06-07 15:56:04.888058+00	2026-07-07 14:00:58.065+00
8889	entities.keyHintAuto	{"en": "Optional. If left empty, the key is generated automatically from the name. Only lowercase latin letters, digits and underscores. Used in the data store.", "he": "אופציונלי. אם יישאר ריק, המפתח ייווצר אוטומטית מהשם. רק אותיות לטיניות קטנות, ספרות וקו תחתון. משמש באחסון הנתונים.", "ru": "Необязательно. Если оставить пустым, ключ будет создан автоматически из названия. Только строчные латинские буквы, цифры и подчёркивания. Используется в хранилище данных."}	2026-06-07 15:56:04.890025+00	2026-07-07 14:00:58.069+00
8713	pages.bindEntity	{"en": "Bind entity", "he": "קשר ישות", "ru": "Привязать сущность"}	2026-06-07 15:56:04.414776+00	2026-07-07 14:01:00.215+00
8712	pages.editEntity	{"en": "Edit entity", "he": "ערוך ישות", "ru": "Редактировать сущность"}	2026-06-07 15:56:04.412081+00	2026-07-07 14:01:00.283+00
10015	fields.cellColor	{"en": "Cell", "he": "תא", "ru": "Ячейка"}	2026-06-07 16:48:22.11782+00	2026-07-07 14:00:58.217+00
8057	pages.mirrorFields	{"en": "Which fields to show (empty = all)", "he": "אילו שדות להציג (ריק = הכול)", "ru": "Какие поля показать (пусто = все)"}	2026-06-07 15:29:55.048279+00	2026-07-07 14:01:00.31+00
10011	fields.false	{"en": "No", "he": "לא", "ru": "Нет"}	2026-06-07 16:48:22.109166+00	2026-07-07 14:00:58.292+00
8058	pages.mirrorNoFields	{"en": "The entity has no fields.", "he": "לישות אין שדות.", "ru": "У сущности нет полей."}	2026-06-07 15:29:55.050966+00	2026-07-07 14:01:00.319+00
9990	records.saveError	{"en": "Failed to save value", "he": "שמירת הערך נכשלה", "ru": "Не удалось сохранить значение"}	2026-06-07 16:48:21.972316+00	2026-07-07 14:01:01.085+00
10013	fields.formatRules	{"en": "Conditional formatting", "he": "עיצוב מותנה", "ru": "Условное форматирование"}	2026-06-07 16:48:22.113617+00	2026-07-07 14:00:58.86+00
10014	fields.formatRulesHint	{"en": "Highlight a cell or row when the value matches a condition. The first matching rule applies.", "he": "הדגשת תא או שורה כאשר הערך עומד בתנאי. הכלל המתאים הראשון מופעל.", "ru": "Подсветка ячейки или строки, когда значение соответствует условию. Срабатывает первое подходящее правило."}	2026-06-07 16:48:22.115687+00	2026-07-07 14:00:58.864+00
10012	fields.formatValue	{"en": "value", "he": "ערך", "ru": "значение"}	2026-06-07 16:48:22.111727+00	2026-07-07 14:00:58.869+00
10006	fields.formula	{"en": "Formula", "he": "נוסחה", "ru": "Формула"}	2026-06-07 16:48:22.09728+00	2026-07-07 14:00:58.934+00
10004	fields.formulaError	{"en": "Formula error", "he": "שגיאת נוסחה", "ru": "Ошибка формулы"}	2026-06-07 16:48:22.092789+00	2026-07-07 14:00:58.937+00
10010	fields.true	{"en": "Yes", "he": "כן", "ru": "Да"}	2026-06-07 16:48:22.107138+00	2026-07-07 14:00:59.126+00
9999	pageFields.addColumn	{"en": "Page field", "he": "שדה דף", "ru": "Поле страницы"}	2026-06-07 16:48:22.078138+00	2026-07-07 14:01:00.156+00
9998	pageFields.badge	{"en": "Page field", "he": "שדה דף", "ru": "Поле страницы"}	2026-06-07 16:48:22.07607+00	2026-07-07 14:01:00.159+00
9997	pageFields.configureColumn	{"en": "Configure page field", "he": "הגדרת שדה דף", "ru": "Настроить поле страницы"}	2026-06-07 16:48:22.073822+00	2026-07-07 14:01:00.162+00
10761	settings.title	{"en": "Settings", "he": "הגדרות", "ru": "Настройки"}	2026-06-07 20:10:59.405725+00	2026-07-07 14:01:01.812+00
10018	pageFields.editTitle	{"en": "Edit page field", "he": "עריכת שדה עמוד", "ru": "Редактировать поле страницы"}	2026-06-07 16:48:22.124573+00	2026-07-07 14:01:00.168+00
10021	pageFields.keyTaken	{"en": "This key is already used on this page.", "he": "מפתח זה כבר בשימוש בעמוד זה.", "ru": "Такой ключ уже используется на этой странице."}	2026-06-07 16:48:22.132754+00	2026-07-07 14:01:00.174+00
10019	pageFields.newTitle	{"en": "New page field", "he": "שדה עמוד חדש", "ru": "Новое поле страницы"}	2026-06-07 16:48:22.128041+00	2026-07-07 14:01:00.178+00
10036	pages.mirrorLocked	{"en": "An entity is already bound to this page. Mirroring is unavailable — a page can be either bound or a mirror.", "he": "ישות כבר מקושרת לדף זה. שיקוף אינו זמין — דף יכול להיות מקושר או משקף.", "ru": "К этой странице уже привязана сущность. Зеркало недоступно — страница может быть либо привязанной, либо зеркалом."}	2026-06-07 16:48:22.170142+00	2026-07-07 14:01:00.316+00
10017	fields.addFormatRule	{"en": "Add rule", "he": "הוספת כלל", "ru": "Добавить правило"}	2026-06-07 16:48:22.122557+00	2026-07-07 14:00:58.206+00
5045	fields.keyInvalid	{"en": "The system key must contain only lowercase Latin letters, digits and underscores, and start with a letter (e.g. attachment).", "he": "המפתח המערכתי חייב להכיל רק אותיות לטיניות קטנות, ספרות וקווים תחתונים, ולהתחיל באות (לדוגמה, attachment).", "ru": "Системный ключ должен состоять только из строчных латинских букв, цифр и подчёркиваний и начинаться с буквы (например, attachment)."}	2026-06-07 13:54:13.183298+00	2026-07-07 14:00:58.97+00
10020	pageFields.dialogDesc	{"en": "A page field is an extra column stored on this page that does not change the source entity.", "he": "שדה עמוד הוא עמודה נוספת שנשמרת בעמוד זה ואינה משנה את הישות המקורית.", "ru": "Поле страницы — это дополнительный столбец, который хранится на этой странице и не изменяет исходную сущность."}	2026-06-07 16:48:22.130633+00	2026-07-07 14:01:00.166+00
10034	pages.pathRequiredError	{"en": "Specify a path for a page with a linked entity", "he": "ציינו נתיב לדף עם ישות מקושרת", "ru": "Укажите путь для страницы со связанной сущностью"}	2026-06-07 16:48:22.164868+00	2026-07-07 14:01:00.347+00
10035	pages.pathRequiredHint	{"en": "A path is required for a page with a linked entity.", "he": "נתיב הוא חובה עבור דף עם ישות מקושרת.", "ru": "Для страницы со связанной сущностью путь обязателен."}	2026-06-07 16:48:22.167453+00	2026-07-07 14:01:00.351+00
10766	settings.email	{"en": "Email", "he": "אימייל", "ru": "Эл. почта"}	2026-06-07 20:10:59.433573+00	2026-07-07 14:01:01.749+00
10764	settings.firstName	{"en": "First name", "he": "שם פרטי", "ru": "Имя"}	2026-06-07 20:10:59.419451+00	2026-07-07 14:01:01.752+00
10765	settings.lastName	{"en": "Last name", "he": "שם משפחה", "ru": "Фамилия"}	2026-06-07 20:10:59.430574+00	2026-07-07 14:01:01.758+00
10763	settings.profile	{"en": "Profile", "he": "פרופיל", "ru": "Профиль"}	2026-06-07 20:10:59.416116+00	2026-07-07 14:01:01.793+00
10768	settings.profileSaved	{"en": "Profile updated", "he": "הפרופיל עודכן", "ru": "Профиль обновлён"}	2026-06-07 20:10:59.440412+00	2026-07-07 14:01:01.796+00
10767	settings.save	{"en": "Save", "he": "שמירה", "ru": "Сохранить"}	2026-06-07 20:10:59.437253+00	2026-07-07 14:01:01.802+00
10762	settings.subtitle	{"en": "Manage your profile and platform", "he": "ניהול הפרופיל והפלטפורמה", "ru": "Управление профилем и платформой"}	2026-06-07 20:10:59.413263+00	2026-07-07 14:01:01.808+00
10770	settings.changePassword	{"en": "Change password", "he": "שינוי סיסמה", "ru": "Смена пароля"}	2026-06-07 20:10:59.446199+00	2026-07-07 14:01:01.727+00
10772	settings.newPassword	{"en": "New password", "he": "סיסמה חדשה", "ru": "Новый пароль"}	2026-06-07 20:10:59.453883+00	2026-07-07 14:01:01.779+00
10775	settings.passwordMismatch	{"en": "Passwords do not match", "he": "הסיסמאות אינן תואמות", "ru": "Пароли не совпадают"}	2026-06-07 20:10:59.462897+00	2026-07-07 14:01:01.788+00
10785	settings.logoMustBeImage	{"en": "The logo must be an image", "he": "הלוגו חייב להיות תמונה", "ru": "Логотип должен быть изображением"}	2026-06-07 20:10:59.49123+00	2026-07-07 14:01:01.768+00
10782	settings.uploadLogo	{"en": "Upload", "he": "העלאה", "ru": "Загрузить"}	2026-06-07 20:10:59.4825+00	2026-07-07 14:01:01.815+00
14419	dash.formatPercent	{"en": "Percent", "he": "אחוז", "ru": "Процент"}	2026-06-07 20:54:44.90633+00	2026-07-07 14:00:57.341+00
11461	fields.formulaInsertField	{"en": "Insert field:", "he": "הוספת שדה:", "ru": "Вставить поле:"}	2026-06-07 20:11:01.225569+00	2026-07-07 14:00:58.945+00
11451	fields.removePreset	{"en": "Remove from palette", "he": "הסרה מהפלטה", "ru": "Удалить из палитры"}	2026-06-07 20:11:01.200109+00	2026-07-07 14:00:59.042+00
10779	settings.appName	{"en": "Company name", "he": "שם החברה", "ru": "Название компании"}	2026-06-07 20:10:59.47379+00	2026-07-07 14:01:01.717+00
10786	settings.logoUploaded	{"en": "Logo uploaded. Don't forget to save.", "he": "הלוגו הועלה. אל תשכח לשמור.", "ru": "Логотип загружен. Не забудьте сохранить."}	2026-06-07 20:10:59.493992+00	2026-07-07 14:01:01.772+00
11448	fields.savedColors	{"en": "Saved colors", "he": "צבעים שמורים", "ru": "Сохранённые цвета"}	2026-06-07 20:11:01.19341+00	2026-07-07 14:00:59.064+00
14423	dash.formula	{"en": "Formula (optional)", "he": "נוסחה (אופציונלי)", "ru": "Формула (необязательно)"}	2026-06-07 20:54:44.91557+00	2026-07-07 14:00:57.343+00
11462	fields.formulaInsertFunc	{"en": "Functions:", "he": "פונקציות:", "ru": "Функции:"}	2026-06-07 20:11:01.228207+00	2026-07-07 14:00:58.948+00
10780	settings.appSubtitle	{"en": "Subtitle", "he": "כותרת משנה", "ru": "Подзаголовок"}	2026-06-07 20:10:59.476499+00	2026-07-07 14:01:01.719+00
10773	settings.confirmPassword	{"en": "Confirm password", "he": "אישור סיסמה", "ru": "Подтвердите пароль"}	2026-06-07 20:10:59.456517+00	2026-07-07 14:01:01.73+00
14421	dash.metrics	{"en": "Metrics", "he": "מדדים", "ru": "Метрики"}	2026-06-07 20:54:44.91089+00	2026-07-07 14:00:57.416+00
11449	fields.noSavedColors	{"en": "Empty for now — save a color with the ★ button", "he": "ריק בינתיים — שמרו צבע באמצעות הכפתור ★", "ru": "Пока пусто — сохраните цвет кнопкой ★"}	2026-06-07 20:11:01.195475+00	2026-07-07 14:00:58.992+00
10778	settings.branding	{"en": "Platform branding", "he": "מיתוג הפלטפורמה", "ru": "Брендинг платформы"}	2026-06-07 20:10:59.471619+00	2026-07-07 14:01:01.722+00
10771	settings.currentPassword	{"en": "Current password", "he": "סיסמה נוכחית", "ru": "Текущий пароль"}	2026-06-07 20:10:59.450958+00	2026-07-07 14:01:01.746+00
10781	settings.logo	{"en": "Logo", "he": "לוגו", "ru": "Логотип"}	2026-06-07 20:10:59.47942+00	2026-07-07 14:01:01.761+00
10787	settings.logoUploadError	{"en": "Failed to upload logo", "he": "העלאת הלוגו נכשלה", "ru": "Не удалось загрузить логотип"}	2026-06-07 20:10:59.497488+00	2026-07-07 14:01:01.775+00
11446	fields.pickColor	{"en": "Pick color", "he": "בחירת צבע", "ru": "Выбрать цвет"}	2026-06-07 20:11:01.188866+00	2026-07-07 14:00:59.04+00
10776	settings.passwordChanged	{"en": "Password changed", "he": "הסיסמה שונתה", "ru": "Пароль изменён"}	2026-06-07 20:10:59.465632+00	2026-07-07 14:01:01.782+00
10774	settings.passwordTooShort	{"en": "Password must be at least 6 characters", "he": "הסיסמה חייבת להכיל לפחות 6 תווים", "ru": "Пароль должен быть не короче 6 символов"}	2026-06-07 20:10:59.460108+00	2026-07-07 14:01:01.79+00
11447	fields.savePreset	{"en": "Save color to palette", "he": "שמירת צבע לפלטה", "ru": "Сохранить цвет в палитру"}	2026-06-07 20:11:01.1909+00	2026-07-07 14:00:59.068+00
10788	settings.brandingSaved	{"en": "Settings saved", "he": "ההגדרות נשמרו", "ru": "Настройки сохранены"}	2026-06-07 20:10:59.500544+00	2026-07-07 14:01:01.724+00
10777	settings.passwordError	{"en": "Failed to change password. Check your current password.", "he": "שינוי הסיסמה נכשל. בדוק את הסיסמה הנוכחית.", "ru": "Не удалось изменить пароль. Проверьте текущий пароль."}	2026-06-07 20:10:59.46893+00	2026-07-07 14:01:01.785+00
10783	settings.removeLogo	{"en": "Remove", "he": "הסרה", "ru": "Удалить"}	2026-06-07 20:10:59.485476+00	2026-07-07 14:01:01.798+00
14422	dash.addMetric	{"en": "Metric", "he": "מדד", "ru": "Метрика"}	2026-06-07 20:54:44.913447+00	2026-07-07 14:00:57.201+00
11452	fields.clearColor	{"en": "Clear color", "he": "ניקוי צבע", "ru": "Очистить цвет"}	2026-06-07 20:11:01.202747+00	2026-07-07 14:00:58.22+00
10769	settings.saveError	{"en": "Failed to save", "he": "השמירה נכשלה", "ru": "Не удалось сохранить"}	2026-06-07 20:10:59.443215+00	2026-07-07 14:01:01.805+00
11463	fields.fnExample	{"en": "Example", "he": "דוגמה", "ru": "Пример"}	2026-06-07 20:11:01.230312+00	2026-07-07 14:00:58.496+00
11450	fields.useColor	{"en": "Use color", "he": "שימוש בצבע", "ru": "Использовать цвет"}	2026-06-07 20:11:01.198054+00	2026-07-07 14:00:59.229+00
14420	dash.color	{"en": "Color", "he": "צבע", "ru": "Цвет"}	2026-06-07 20:54:44.90895+00	2026-07-07 14:00:57.267+00
10784	settings.logoHint	{"en": "PNG or SVG with a transparent background works best.", "he": "PNG או SVG עם רקע שקוף מתאים ביותר.", "ru": "PNG или SVG с прозрачным фоном смотрятся лучше всего."}	2026-06-07 20:10:59.487999+00	2026-07-07 14:01:01.765+00
14417	dash.formatNumber	{"en": "Number", "he": "מספר", "ru": "Число"}	2026-06-07 20:54:44.901719+00	2026-07-07 14:00:57.339+00
14405	dash.hasFormula	{"en": "formula", "he": "נוסחה", "ru": "формула"}	2026-06-07 20:54:44.87218+00	2026-07-07 14:00:57.382+00
14415	dash.icon	{"en": "Icon", "he": "סמל", "ru": "Иконка"}	2026-06-07 20:54:44.897014+00	2026-07-07 14:00:57.385+00
14404	dash.metricsCount	{"en": "Metrics", "he": "מדדים", "ru": "Метрик"}	2026-06-07 20:54:44.870175+00	2026-07-07 14:00:57.42+00
14413	dash.newWidget	{"en": "New widget", "he": "וידג'ט חדש", "ru": "Новый виджет"}	2026-06-07 20:54:44.892216+00	2026-07-07 14:00:57.429+00
14400	dash.addWidget	{"en": "Add widget", "he": "הוסף וידג'ט", "ru": "Добавить виджет"}	2026-06-07 20:54:44.860471+00	2026-07-07 14:00:57.206+00
14410	dash.cancel	{"en": "Cancel", "he": "ביטול", "ru": "Отмена"}	2026-06-07 20:54:44.885198+00	2026-07-07 14:00:57.228+00
14402	dash.configure	{"en": "Configure", "he": "הגדרה", "ru": "Настроить"}	2026-06-07 20:54:44.865239+00	2026-07-07 14:00:57.288+00
14396	dash.created	{"en": "Widget created", "he": "וידג'ט נוצר", "ru": "Виджет создан"}	2026-06-07 20:54:44.851261+00	2026-07-07 14:00:57.29+00
14411	dash.delete	{"en": "Delete", "he": "מחק", "ru": "Удалить"}	2026-06-07 20:54:44.887361+00	2026-07-07 14:00:57.293+00
14406	dash.roleLimited	{"en": "role-limited", "he": "מוגבל לתפקידים", "ru": "ограничено ролями"}	2026-06-07 20:54:44.874816+00	2026-07-07 14:00:57.699+00
14399	dash.saveError	{"en": "Failed to save widget", "he": "שמירת הווידג'ט נכשלה", "ru": "Ошибка сохранения виджета"}	2026-06-07 20:54:44.85803+00	2026-07-07 14:00:57.713+00
14397	dash.updated	{"en": "Widget updated", "he": "וידג'ט עודכן", "ru": "Виджет обновлён"}	2026-06-07 20:54:44.853311+00	2026-07-07 14:00:57.79+00
14414	dash.widgetTitle	{"en": "Title", "he": "כותרת", "ru": "Заголовок"}	2026-06-07 20:54:44.894737+00	2026-07-07 14:00:57.797+00
12989	settings.language	{"en": "Interface language", "he": "שפת הממשק", "ru": "Язык интерфейса"}	2026-06-07 20:35:56.945178+00	2026-07-07 14:01:01.755+00
12393	users.allRoles	{"en": "All roles", "he": "כל התפקידים", "ru": "Все роли"}	2026-06-07 20:31:41.67759+00	2026-07-07 14:01:01.995+00
14409	dash.deleteConfirm	{"en": "will be permanently deleted.", "he": "יימחק לצמיתות.", "ru": "будет удалён безвозвратно."}	2026-06-07 20:54:44.882549+00	2026-07-07 14:00:57.297+00
14398	dash.deleted	{"en": "Widget deleted", "he": "וידג'ט נמחק", "ru": "Виджет удалён"}	2026-06-07 20:54:44.855904+00	2026-07-07 14:00:57.3+00
14408	dash.deleteTitle	{"en": "Delete widget?", "he": "למחוק וידג'ט?", "ru": "Удалить виджет?"}	2026-06-07 20:54:44.879795+00	2026-07-07 14:00:57.303+00
14401	dash.done	{"en": "Done", "he": "סיום", "ru": "Готово"}	2026-06-07 20:54:44.862621+00	2026-07-07 14:00:57.307+00
14412	dash.editWidget	{"en": "Edit widget", "he": "עריכת וידג'ט", "ru": "Редактировать виджет"}	2026-06-07 20:54:44.890063+00	2026-07-07 14:00:57.319+00
12392	users.filterByRole	{"en": "Filter by role", "he": "סינון לפי תפקיד", "ru": "Фильтр по роли"}	2026-06-07 20:31:41.674584+00	2026-07-07 14:01:02.07+00
2743	users.guestUserHint	{"en": "Link-only sign-in, read-only mode. Assign the “Guest” role.", "he": "כניסה באמצעות קישור בלבד, מצב קריאה בלבד. הקצו את תפקיד «אורח».", "ru": "Вход только по ссылке, режим только для чтения. Назначьте роль «Гость»."}	2026-06-07 12:47:46.879438+00	2026-07-07 14:01:02.088+00
14403	dash.empty	{"en": "No widgets yet", "he": "אין עדיין וידג'טים", "ru": "Виджеты ещё не добавлены"}	2026-06-07 20:54:44.867343+00	2026-07-07 14:00:57.323+00
14407	dash.emptyViewer	{"en": "This dashboard has no widgets yet", "he": "בלוח זה אין עדיין וידג'טים", "ru": "На этой панели пока нет виджетов"}	2026-06-07 20:54:44.87702+00	2026-07-07 14:00:57.326+00
14416	dash.format	{"en": "Format", "he": "פורמט", "ru": "Формат"}	2026-06-07 20:54:44.89968+00	2026-07-07 14:00:57.332+00
14418	dash.formatCurrency	{"en": "Currency", "he": "מטבע", "ru": "Валюта"}	2026-06-07 20:54:44.904291+00	2026-07-07 14:00:57.335+00
14428	dash.invalidKey	{"en": "Invalid metric key (letters/digits/_)", "he": "מפתח מדד לא תקין (אותיות/ספרות/_)", "ru": "Некорректный ключ метрики (латиница/цифры/_)"}	2026-06-07 20:54:44.92796+00	2026-07-07 14:00:57.389+00
14425	dash.restrictRoles	{"en": "Restrict visibility by role", "he": "הגבל נראות לפי תפקיד", "ru": "Ограничить видимость по ролям"}	2026-06-07 20:54:44.920592+00	2026-07-07 14:00:57.695+00
16034	fields.showColumnTotal	{"en": "Show column total", "he": "הצג סכום עמודה", "ru": "Показывать сумму столбца"}	2026-06-07 21:39:24.457661+00	2026-07-07 14:00:59.072+00
14439	pages.pageType	{"en": "Page type", "he": "סוג עמוד", "ru": "Тип страницы"}	2026-06-07 20:54:44.952188+00	2026-07-07 14:01:00.332+00
14443	pages.typeDashboard	{"en": "Dashboard (widgets)", "he": "לוח מחוונים (וידג'טים)", "ru": "Дашборд (виджеты)"}	2026-06-07 20:54:44.961971+00	2026-07-07 14:01:00.385+00
14440	pages.typeLocked	{"en": "This page already has a bound entity. Only the normal type is available — it cannot be a mirror or a dashboard.", "he": "לעמוד זה כבר משויכת ישות. זמין רק הסוג הרגיל — הוא אינו יכול להיות מראה או לוח מחוונים.", "ru": "К этой странице уже привязана сущность. Доступен только обычный тип — страница не может быть зеркалом или дашбордом."}	2026-06-07 20:54:44.95535+00	2026-07-07 14:01:00.44+00
14442	pages.typeMirror	{"en": "Mirror (live entity data)", "he": "מראה (נתוני ישות חיים)", "ru": "Зеркальная (живые данные сущности)"}	2026-06-07 20:54:44.959861+00	2026-07-07 14:01:00.444+00
14441	pages.typeNormal	{"en": "Normal", "he": "רגיל", "ru": "Обычная"}	2026-06-07 20:54:44.957368+00	2026-07-07 14:01:00.447+00
14427	dash.save	{"en": "Save", "he": "שמור", "ru": "Сохранить"}	2026-06-07 20:54:44.92542+00	2026-07-07 14:00:57.706+00
16035	records.columnTotal	{"en": "Total", "he": "סכום", "ru": "Сумма"}	2026-06-07 21:39:24.462472+00	2026-07-07 14:01:00.52+00
14445	pages.dashboardHint	{"en": "The page will show a widget dashboard. Widgets are configured on the page itself via the “Configure” button.", "he": "העמוד יציג לוח וידג'טים. הווידג'טים מוגדרים בעמוד עצמו באמצעות כפתור «הגדרה».", "ru": "Страница покажет панель виджетов. Виджеты настраиваются на самой странице кнопкой «Настроить»."}	2026-06-07 20:54:44.967035+00	2026-07-07 14:01:00.257+00
14434	dash.aggCount	{"en": "Count", "he": "ספירה", "ru": "Количество"}	2026-06-07 20:54:44.941184+00	2026-07-07 14:00:57.21+00
14435	dash.aggSum	{"en": "Sum", "he": "סכום", "ru": "Сумма"}	2026-06-07 20:54:44.943232+00	2026-07-07 14:00:57.218+00
14432	dash.metricKey	{"en": "key", "he": "מפתח", "ru": "ключ"}	2026-06-07 20:54:44.936707+00	2026-07-07 14:00:57.395+00
14426	dash.allRoles	{"en": "Visible to all roles with page access.", "he": "גלוי לכל התפקידים עם גישה לעמוד.", "ru": "Виден всем ролям с доступом к странице."}	2026-06-07 20:54:44.923468+00	2026-07-07 14:00:57.222+00
14444	pages.mirrorSelect	{"en": "— Select entity —", "he": "— בחר ישות —", "ru": "— Выберите сущность —"}	2026-06-07 20:54:44.964623+00	2026-07-07 14:01:00.325+00
14430	dash.metricNeedsEntity	{"en": "Select an entity for each metric", "he": "בחר ישות לכל מדד", "ru": "Выберите сущность для каждой метрики"}	2026-06-07 20:54:44.932281+00	2026-07-07 14:00:57.398+00
14433	dash.selectEntity	{"en": "Entity", "he": "ישות", "ru": "Сущность"}	2026-06-07 20:54:44.938785+00	2026-07-07 14:00:57.716+00
14543	settings.currency	{"en": "Currency symbol", "he": "סמל מטבע", "ru": "Символ валюты"}	2026-06-07 21:16:12.079089+00	2026-07-07 14:01:01.732+00
14544	settings.currencyHint	{"en": "Used everywhere a monetary amount is shown (e.g. dashboard widgets). For example: ₽, $, €, ₸.", "he": "משמש בכל מקום שבו מוצג סכום כספי (למשל ווידג'טים בלוח המחוונים). לדוגמה: ₽, $, €, ₸.", "ru": "Используется везде, где отображается денежная сумма (например, виджеты дашборда). Например: ₽, $, €, ₸."}	2026-06-07 21:16:12.084871+00	2026-07-07 14:01:01.736+00
14429	dash.dupKey	{"en": "Metric keys must be unique", "he": "מפתחות המדדים חייבים להיות ייחודיים", "ru": "Ключи метрик должны быть уникальны"}	2026-06-07 20:54:44.929816+00	2026-07-07 14:00:57.312+00
14424	dash.formulaHint	{"en": "Combine metrics by key: {m1}. Without a formula the first metric is shown.", "he": "שלב מדדים לפי מפתח: {m1}. ללא נוסחה מוצג המדד הראשון.", "ru": "Комбинируйте метрики по ключу: {m1}. Без формулы показывается первая метрика."}	2026-06-07 20:54:44.918067+00	2026-07-07 14:00:57.346+00
14431	dash.metricNeedsField	{"en": "Select a numeric field for sum", "he": "בחר שדה מספרי לסכום", "ru": "Для суммы выберите числовое поле"}	2026-06-07 20:54:44.934308+00	2026-07-07 14:00:57.401+00
14437	dash.noNumericFields	{"en": "No numeric fields", "he": "אין שדות מספריים", "ru": "Нет числовых полей"}	2026-06-07 20:54:44.947581+00	2026-07-07 14:00:57.533+00
14436	dash.selectField	{"en": "Numeric field", "he": "שדה מספרי", "ru": "Числовое поле"}	2026-06-07 20:54:44.945544+00	2026-07-07 14:00:57.721+00
14438	dash.statusFilter	{"en": "Statuses (empty = all)", "he": "סטטוסים (ריק = הכול)", "ru": "Статусы (пусто = все)"}	2026-06-07 20:54:44.950144+00	2026-07-07 14:00:57.742+00
16036	dash.widgetType	{"en": "Widget type", "he": "סוג וידג'ט", "ru": "Тип виджета"}	2026-06-07 21:39:24.465139+00	2026-07-07 14:00:57.799+00
17693	dash.gridHShort	{"en": "H", "he": "ג", "ru": "В"}	2026-06-07 22:22:41.012003+00	2026-07-07 14:00:57.352+00
17692	dash.gridWShort	{"en": "W", "he": "ר", "ru": "Ш"}	2026-06-07 22:22:41.009823+00	2026-07-07 14:00:57.361+00
16053	dash.aggregation	{"en": "Aggregation", "he": "צבירה", "ru": "Агрегация"}	2026-06-07 21:39:24.506166+00	2026-07-07 14:00:57.215+00
16633	records.dateFilterToday	{"en": "Today", "he": "היום", "ru": "Сегодня"}	2026-06-07 21:48:43.710358+00	2026-07-07 14:01:00.611+00
18078	views.manualValue	{"en": "manual…", "he": "ידני…", "ru": "вручную…"}	2026-06-07 22:39:23.711449+00	2026-07-07 14:01:02.391+00
18079	views.noOptions	{"en": "No options", "he": "אין אפשרויות", "ru": "Нет вариантов"}	2026-06-07 22:39:23.713769+00	2026-07-07 14:01:02.408+00
18077	views.selectValue	{"en": "select value", "he": "בחר ערך", "ru": "выберите значение"}	2026-06-07 22:39:23.709443+00	2026-07-07 14:01:02.479+00
27181	dash.notesAlignRight	{"en": "Align right", "he": "יישור לימין", "ru": "По правому краю"}	2026-06-08 16:12:01.200057+00	2026-07-07 14:00:57.557+00
27182	dash.notesLink	{"en": "Link", "he": "קישור", "ru": "Ссылка"}	2026-06-08 16:12:01.203414+00	2026-07-07 14:00:57.639+00
23561	dash.saved	{"en": "Saved", "he": "נשמר", "ru": "Сохранено"}	2026-06-08 08:07:18.921562+00	2026-07-07 14:00:57.709+00
17696	dash.sizeHint	{"en": "Widget size is adjusted directly on the grid in configure mode.", "he": "גודל הווידג'ט מותאם ישירות ברשת במצב הגדרה.", "ru": "Размер виджета настраивается прямо на сетке в режиме настройки."}	2026-06-07 22:22:41.019465+00	2026-07-07 14:00:57.736+00
16635	records.dateFilter30days	{"en": "30 days", "he": "30 ימים", "ru": "30 дней"}	2026-06-07 21:48:43.714984+00	2026-07-07 14:01:00.589+00
16049	dash.groupBy	{"en": "Group by", "he": "קבץ לפי", "ru": "Группировать по"}	2026-06-07 21:39:24.495657+00	2026-07-07 14:00:57.365+00
16046	dash.chartArea	{"en": "Area", "he": "שטח", "ru": "Область"}	2026-06-07 21:39:24.488069+00	2026-07-07 14:00:57.231+00
16044	dash.chartBar	{"en": "Bar", "he": "עמודות", "ru": "Столбчатый"}	2026-06-07 21:39:24.483438+00	2026-07-07 14:00:57.234+00
16048	dash.chartDonut	{"en": "Donut", "he": "טבעת", "ru": "Кольцевой"}	2026-06-07 21:39:24.493679+00	2026-07-07 14:00:57.237+00
16045	dash.chartLine	{"en": "Line", "he": "קו", "ru": "Линейный"}	2026-06-07 21:39:24.485309+00	2026-07-07 14:00:57.241+00
16056	dash.chartNeedsEntity	{"en": "Select an entity for the chart", "he": "בחר ישות לתרשים", "ru": "Выберите сущность для графика"}	2026-06-07 21:39:24.5133+00	2026-07-07 14:00:57.243+00
16051	dash.groupByField	{"en": "Field", "he": "שדה", "ru": "Полю"}	2026-06-07 21:39:24.500847+00	2026-07-07 14:00:57.372+00
16050	dash.groupByStatus	{"en": "Status", "he": "סטטוס", "ru": "Статусу"}	2026-06-07 21:39:24.498445+00	2026-07-07 14:00:57.376+00
16052	dash.groupField	{"en": "Group field", "he": "שדה קיבוץ", "ru": "Поле группировки"}	2026-06-07 21:39:24.503823+00	2026-07-07 14:00:57.379+00
17694	dash.moveBack	{"en": "Move back", "he": "הזז אחורה", "ru": "Переместить назад"}	2026-06-07 22:22:41.01474+00	2026-07-07 14:00:57.423+00
16634	records.dateFilter7days	{"en": "7 days", "he": "7 ימים", "ru": "7 дней"}	2026-06-07 21:48:43.712624+00	2026-07-07 14:01:00.592+00
16637	records.dateFilterLastMonth	{"en": "Last month", "he": "החודש שעבר", "ru": "Прошлый месяц"}	2026-06-07 21:48:43.719869+00	2026-07-07 14:01:00.596+00
16639	records.dateFilterMax	{"en": "All time", "he": "כל הזמן", "ru": "Максимум"}	2026-06-07 21:48:43.730087+00	2026-07-07 14:01:00.599+00
17695	dash.moveForward	{"en": "Move forward", "he": "הזז קדימה", "ru": "Переместить вперёд"}	2026-06-07 22:22:41.016816+00	2026-07-07 14:00:57.426+00
16055	dash.noData	{"en": "No data", "he": "אין נתונים", "ru": "Нет данных"}	2026-06-07 21:39:24.510803+00	2026-07-07 14:00:57.527+00
16057	dash.chartNeedsGroupField	{"en": "Select a field to group by", "he": "בחר שדה לקיבוץ", "ru": "Выберите поле для группировки"}	2026-06-07 21:39:24.515304+00	2026-07-07 14:00:57.246+00
16636	records.dateFilterThisMonth	{"en": "This month", "he": "החודש", "ru": "Этот месяц"}	2026-06-07 21:48:43.717714+00	2026-07-07 14:01:00.604+00
16047	dash.chartPie	{"en": "Pie", "he": "עוגה", "ru": "Круговой"}	2026-06-07 21:39:24.490727+00	2026-07-07 14:00:57.249+00
16042	dash.chartSettings	{"en": "Chart settings", "he": "הגדרות תרשים", "ru": "Настройки графика"}	2026-06-07 21:39:24.478702+00	2026-07-07 14:00:57.252+00
16638	records.dateFilterThisYear	{"en": "This year", "he": "השנה", "ru": "Этот год"}	2026-06-07 21:48:43.722432+00	2026-07-07 14:01:00.607+00
16043	dash.chartType	{"en": "Chart type", "he": "סוג תרשים", "ru": "Тип графика"}	2026-06-07 21:39:24.480873+00	2026-07-07 14:00:57.254+00
16054	dash.noFields	{"en": "No fields", "he": "אין שדות", "ru": "Нет полей"}	2026-06-07 21:39:24.508709+00	2026-07-07 14:00:57.53+00
27180	dash.notesAlignCenter	{"en": "Align center", "he": "יישור למרכז", "ru": "По центру"}	2026-06-08 16:12:01.197887+00	2026-07-07 14:00:57.549+00
27179	dash.notesAlignLeft	{"en": "Align left", "he": "יישור לשמאל", "ru": "По левому краю"}	2026-06-08 16:12:01.195095+00	2026-07-07 14:00:57.554+00
22700	dash.analyticsSection	{"en": "Analytics", "he": "אנליטיקה", "ru": "Аналитика"}	2026-06-08 07:41:40.780502+00	2026-07-07 14:00:57.225+00
19357	dash.typeTable	{"en": "Table", "he": "טבלה", "ru": "Таблица"}	2026-06-07 22:53:33.464273+00	2026-07-07 14:00:57.787+00
23558	dash.collapse	{"en": "Collapse", "he": "כווץ", "ru": "Свернуть"}	2026-06-08 08:07:18.913775+00	2026-07-07 14:00:57.26+00
23560	dash.collapsedDefault	{"en": "Collapsed by default", "he": "מכווץ כברירת מחדל", "ru": "Свёрнуто по умолчанию"}	2026-06-08 08:07:18.91865+00	2026-07-07 14:00:57.264+00
23556	dash.statusColumn	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-06-08 08:07:18.908904+00	2026-07-07 14:00:57.739+00
19360	dash.tableColumns	{"en": "Columns (selection order)", "he": "עמודות (סדר בחירה)", "ru": "Колонки (порядок выбора)"}	2026-06-07 22:53:33.472205+00	2026-07-07 14:00:57.748+00
23557	dash.viewAll	{"en": "View all", "he": "הצג הכול", "ru": "Смотреть все"}	2026-06-08 08:07:18.911671+00	2026-07-07 14:00:57.793+00
18578	fields.textColor	{"en": "Text", "he": "טקסט", "ru": "Текст"}	2026-06-07 22:39:24.968824+00	2026-07-07 14:00:59.11+00
19365	dash.tableNeedsColumns	{"en": "Select at least one column", "he": "בחר לפחות עמודה אחת", "ru": "Выберите хотя бы одну колонку"}	2026-06-07 22:53:33.482911+00	2026-07-07 14:00:57.751+00
21897	fields.totalColorsHint	{"en": "Column total cell colors (optional)", "he": "צבעי תא סכום העמודה (אופציונלי)", "ru": "Цвета ячейки итога столбца (необязательно)"}	2026-06-08 05:40:28.568509+00	2026-07-07 14:00:59.115+00
19364	dash.tableNeedsEntity	{"en": "Select an entity for the table", "he": "בחר ישות עבור הטבלה", "ru": "Выберите сущность для таблицы"}	2026-06-07 22:53:33.480812+00	2026-07-07 14:00:57.755+00
19361	dash.tableSelectEntityFirst	{"en": "Select an entity first", "he": "בחר תחילה ישות", "ru": "Сначала выберите сущность"}	2026-06-07 22:53:33.474152+00	2026-07-07 14:00:57.761+00
19359	dash.tableSettings	{"en": "Table settings", "he": "הגדרות טבלה", "ru": "Настройки таблицы"}	2026-06-07 22:53:33.469547+00	2026-07-07 14:00:57.764+00
19358	dash.tableWidget	{"en": "Table", "he": "טבלה", "ru": "Таблица"}	2026-06-07 22:53:33.466814+00	2026-07-07 14:00:57.766+00
21898	fields.totalFillColor	{"en": "Fill color", "he": "צבע מילוי", "ru": "Цвет заливки"}	2026-06-08 05:40:28.572939+00	2026-07-07 14:00:59.12+00
21899	fields.totalTextColor	{"en": "Text color", "he": "צבע טקסט", "ru": "Цвет текста"}	2026-06-08 05:40:28.575848+00	2026-07-07 14:00:59.124+00
2698	gdrive.builtinMissing	{"en": "Built-in keys are set at the platform level via the GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET environment variables (not through this form) and are not configured yet. Add these secrets to the environment, or choose the \\"Own\\" mode and enter your own keys below.", "he": "המפתחות המובנים מוגדרים ברמת הפלטפורמה דרך משתני הסביבה GOOGLE_OAUTH_CLIENT_ID ו-GOOGLE_OAUTH_CLIENT_SECRET (לא דרך טופס זה) וכרגע אינם מוגדרים. הוסיפו סודות אלה לסביבה או בחרו במצב «משלך» והזינו מפתחות משלכם למטה.", "ru": "Встроенные ключи задаются на уровне платформы через переменные окружения GOOGLE_OAUTH_CLIENT_ID и GOOGLE_OAUTH_CLIENT_SECRET (не через эту форму) и сейчас не настроены. Добавьте эти секреты в окружение или выберите режим «Собственные» и введите свои ключи ниже."}	2026-06-07 12:47:46.760534+00	2026-07-07 14:00:59.385+00
21013	dash.colorStyle	{"en": "Color style", "he": "סגנון צבע", "ru": "Применение цвета"}	2026-06-07 23:16:00.805676+00	2026-07-07 14:00:57.271+00
21015	dash.colorStyleBorder	{"en": "Border", "he": "מסגרת", "ru": "Обводка"}	2026-06-07 23:16:00.81189+00	2026-07-07 14:00:57.273+00
21016	dash.colorStyleFill	{"en": "Fill", "he": "מילוי", "ru": "Заливка"}	2026-06-07 23:16:00.813701+00	2026-07-07 14:00:57.277+00
21014	dash.colorStyleIcon	{"en": "Icon", "he": "סמל", "ru": "Иконка"}	2026-06-07 23:16:00.809654+00	2026-07-07 14:00:57.28+00
21017	dash.textColor	{"en": "Text color", "he": "צבע טקסט", "ru": "Цвет шрифта"}	2026-06-07 23:16:00.815873+00	2026-07-07 14:00:57.769+00
21019	dash.textColorDark	{"en": "Dark", "he": "כהה", "ru": "Тёмный"}	2026-06-07 23:16:00.820341+00	2026-07-07 14:00:57.773+00
19363	dash.columnsCount	{"en": "Columns", "he": "עמודות", "ru": "Колонок"}	2026-06-07 22:53:33.478565+00	2026-07-07 14:00:57.283+00
23559	dash.expand	{"en": "Expand", "he": "הרחב", "ru": "Развернуть"}	2026-06-08 08:07:18.91638+00	2026-07-07 14:00:57.329+00
21018	dash.textColorLight	{"en": "Light", "he": "בהיר", "ru": "Светлый"}	2026-06-07 23:16:00.817557+00	2026-07-07 14:00:57.775+00
19362	dash.rowLimit	{"en": "Row count (1–100)", "he": "מספר שורות (1–100)", "ru": "Кол-во строк (1–100)"}	2026-06-07 22:53:33.476582+00	2026-07-07 14:00:57.703+00
20200	dash.showValues	{"en": "Show values on the chart", "he": "הצג ערכים על התרשים", "ru": "Показывать значения на графике"}	2026-06-07 23:01:33.532008+00	2026-07-07 14:00:57.733+00
24975	records.relatedSearch	{"en": "Search record...", "he": "חיפוש רשומה...", "ru": "Поиск записи..."}	2026-06-08 11:39:35.502396+00	2026-07-07 14:01:01.071+00
24477	dash.tableRelatedColumns	{"en": "Related columns", "he": "עמודות מקושרות", "ru": "Связанные колонки"}	2026-06-08 09:45:13.16008+00	2026-07-07 14:00:57.758+00
27173	dash.notesBold	{"en": "Bold", "he": "מודגש", "ru": "Жирный"}	2026-06-08 16:12:01.18093+00	2026-07-07 14:00:57.56+00
27172	dash.notesModeTable	{"en": "Value table", "he": "טבלת ערכים", "ru": "Таблица значений"}	2026-06-08 16:12:01.178974+00	2026-07-07 14:00:57.648+00
24473	dash.metricNoRelation	{"en": "No relation (on the entity itself)", "he": "ללא קשר (על הישות עצמה)", "ru": "Без связи (по самой сущности)"}	2026-06-08 09:45:13.149375+00	2026-07-07 14:00:57.404+00
55064	fields.fileSourceOrderHint	{"en": "Source order. The first one is used by default.", "he": "סדר המקורות. הראשון משמש כברירת מחדל.", "ru": "Порядок источников. Первый используется по умолчанию."}	2026-06-13 19:23:04.674376+00	2026-07-07 14:00:58.32+00
24411	pageFields.relationPlaceholder	{"en": "Select a relation", "he": "בחרו קשר", "ru": "Выберите связь"}	2026-06-08 09:45:12.991789+00	2026-07-07 14:01:00.207+00
24978	records.linkFailed	{"en": "Failed to change the link", "he": "שינוי הקישור נכשל", "ru": "Не удалось изменить связь"}	2026-06-08 11:39:35.510127+00	2026-07-07 14:01:00.973+00
24976	records.relatedNotFound	{"en": "No records found", "he": "לא נמצאו רשומות", "ru": "Записи не найдены"}	2026-06-08 11:39:35.504774+00	2026-07-07 14:01:01.067+00
27176	dash.notesStrike	{"en": "Strikethrough", "he": "קו חוצה", "ru": "Зачёркнутый"}	2026-06-08 16:12:01.188174+00	2026-07-07 14:00:57.684+00
24476	dash.selectRelatedField	{"en": "Linked record field", "he": "שדה של רשומה מקושרת", "ru": "Поле связанной записи"}	2026-06-08 09:45:13.156993+00	2026-07-07 14:00:57.729+00
27170	dash.typeNotes	{"en": "Notes", "he": "הערות", "ru": "Заметки"}	2026-06-08 16:12:01.173164+00	2026-07-07 14:00:57.784+00
47254	fields.dependsOnHint	{"en": "Values for this field are suggested from existing records that share the same parent value.", "he": "ערכי שדה זה יוצעו מתוך רשומות קיימות בעלות אותו ערך אב.", "ru": "Значения этого поля будут подсказываться из существующих записей с тем же родительским значением."}	2026-06-10 14:14:34.869126+00	2026-07-07 14:00:58.259+00
24974	records.clickToAssign	{"en": "Click to assign a link", "he": "לחץ כדי לשייך קישור", "ru": "Нажмите, чтобы назначить связь"}	2026-06-08 11:39:35.49836+00	2026-07-07 14:01:00.512+00
24412	pageFields.noRelations	{"en": "No suitable relations for this entity.", "he": "אין קשרים מתאימים לישות זו.", "ru": "Нет подходящих связей для этой сущности."}	2026-06-08 09:45:12.994047+00	2026-07-07 14:01:00.181+00
24413	pageFields.relatedField	{"en": "Related entity field", "he": "שדה של הישות המקושרת", "ru": "Поле связанной сущности"}	2026-06-08 09:45:12.996917+00	2026-07-07 14:01:00.185+00
24414	pageFields.relatedFieldPlaceholder	{"en": "Select a field", "he": "בחרו שדה", "ru": "Выберите поле"}	2026-06-08 09:45:12.999495+00	2026-07-07 14:01:00.188+00
24409	pageFields.relationHint	{"en": "A related field shows a value from the single linked record. One-to-one and many-to-one relations are available (as well as the one-to-many inverse side).", "he": "שדה מקושר מציג ערך מהרשומה המקושרת היחידה. זמינים קשרי אחד-לאחד ורבים-לאחד (וגם הצד ההפוך של אחד-לרבים).", "ru": "Связанное поле показывает значение из единственной связанной записи. Доступны связи «один к одному» и «многие к одному» (а также обратная сторона «один ко многим»)."}	2026-06-08 09:45:12.986711+00	2026-07-07 14:01:00.204+00
27174	dash.notesItalic	{"en": "Italic", "he": "נטוי", "ru": "Курсив"}	2026-06-08 16:12:01.183493+00	2026-07-07 14:00:57.635+00
54804	common.moveDown	{"en": "Move down", "he": "למטה", "ru": "Вниз"}	2026-06-13 19:23:03.253082+00	2026-07-07 14:00:57.172+00
24472	dash.metricRelation	{"en": "Relation (optional)", "he": "קשר (אופציונלי)", "ru": "Связь (необязательно)"}	2026-06-08 09:45:13.146649+00	2026-07-07 14:00:57.407+00
24474	dash.metricRelationCountHint	{"en": "Counts linked records", "he": "סופר רשומות מקושרות", "ru": "Считает связанные записи"}	2026-06-08 09:45:13.152146+00	2026-07-07 14:00:57.41+00
24475	dash.metricRelationSumHint	{"en": "Sums a linked record's field", "he": "מסכם שדה של רשומה מקושרת", "ru": "Суммирует поле связанной записи"}	2026-06-08 09:45:13.154946+00	2026-07-07 14:00:57.413+00
47252	fields.dependsOn	{"en": "Depends on field", "he": "תלוי בשדה", "ru": "Зависит от поля"}	2026-06-10 14:14:34.862307+00	2026-07-07 14:00:58.253+00
24410	pageFields.relation	{"en": "Relation", "he": "קשר", "ru": "Связь"}	2026-06-08 09:45:12.988955+00	2026-07-07 14:01:00.194+00
24977	records.clearLink	{"en": "Clear link", "he": "נקה קישור", "ru": "Очистить связь"}	2026-06-08 11:39:35.507584+00	2026-07-07 14:01:00.509+00
25302	dash.dragHint	{"en": "Drag to reorder", "he": "גרור כדי לשנות את הסדר", "ru": "Перетащите, чтобы изменить порядок"}	2026-06-08 11:39:36.375901+00	2026-07-07 14:00:57.309+00
25859	records.resizeColumn	{"en": "Drag to resize (double-click to reset)", "he": "גרור לשינוי רוחב (לחיצה כפולה לאיפוס)", "ru": "Потяните, чтобы изменить ширину (двойной клик — сбросить)"}	2026-06-08 12:00:38.185245+00	2026-07-07 14:01:01.077+00
27177	dash.notesBullet	{"en": "Bullet list", "he": "רשימת תבליטים", "ru": "Маркированный список"}	2026-06-08 16:12:01.190128+00	2026-07-07 14:00:57.563+00
27171	dash.notesModeRich	{"en": "Rich text", "he": "טקסט מעוצב", "ru": "Форматированный текст"}	2026-06-08 16:12:01.176393+00	2026-07-07 14:00:57.645+00
27178	dash.notesOrdered	{"en": "Numbered list", "he": "רשימה ממוספרת", "ru": "Нумерованный список"}	2026-06-08 16:12:01.192838+00	2026-07-07 14:00:57.654+00
27175	dash.notesUnderline	{"en": "Underline", "he": "קו תחתון", "ru": "Подчёркнутый"}	2026-06-08 16:12:01.185593+00	2026-07-07 14:00:57.692+00
27234	records.fileRemoveConfirmGdrive	{"en": "The file link will be removed from this field. The file in Google Drive itself stays unchanged.", "he": "קישור הקובץ יוסר משדה זה. הקובץ ב-Google Drive עצמו יישאר ללא שינוי.", "ru": "Ссылка на файл будет удалена из этого поля. Сам файл в Google Drive останется без изменений."}	2026-06-08 16:12:01.327845+00	2026-07-07 14:01:00.68+00
27235	records.fileRemoveConfirmServer	{"en": "The file will be detached from this field and moved to the file trash — it can be restored.", "he": "הקובץ ינותק משדה זה ויועבר לסל הקבצים — ניתן יהיה לשחזרו.", "ru": "Файл будет откреплён от этого поля и перемещён в корзину файлов — его можно будет восстановить."}	2026-06-08 16:12:01.329964+00	2026-07-07 14:01:00.684+00
27198	dash.notesSourceNeedsEntity	{"en": "Select an entity for the value", "he": "בחר ישות עבור הערך", "ru": "Выберите сущность для значения"}	2026-06-08 16:12:01.241394+00	2026-07-07 14:00:57.672+00
27193	dash.notesSourceRecord	{"en": "Record value", "he": "ערך רשומה", "ru": "Значение записи"}	2026-06-08 16:12:01.229399+00	2026-07-07 14:00:57.676+00
27233	records.fileRemoveConfirmTitle	{"en": "Remove file from the field?", "he": "להסיר את הקובץ מהשדה?", "ru": "Удалить файл из поля?"}	2026-06-08 16:12:01.325214+00	2026-07-07 14:01:00.687+00
27214	dash.loading	{"en": "Loading…", "he": "טוען…", "ru": "Загрузка…"}	2026-06-08 16:12:01.279023+00	2026-07-07 14:00:57.392+00
27190	dash.notesSources	{"en": "Values", "he": "ערכים", "ru": "Значения"}	2026-06-08 16:12:01.222897+00	2026-07-07 14:00:57.68+00
27185	dash.notesColorReset	{"en": "Reset color", "he": "איפוס צבע", "ru": "Сбросить цвет"}	2026-06-08 16:12:01.211002+00	2026-07-07 14:00:57.598+00
27202	dash.notesAddCol	{"en": "Column", "he": "עמודה", "ru": "Колонка"}	2026-06-08 16:12:01.252056+00	2026-07-07 14:00:57.541+00
27186	dash.notesEditCell	{"en": "Cell", "he": "תא", "ru": "Ячейка"}	2026-06-08 16:12:01.213689+00	2026-07-07 14:00:57.616+00
27201	dash.notesAddRow	{"en": "Row", "he": "שורה", "ru": "Строка"}	2026-06-08 16:12:01.249409+00	2026-07-07 14:00:57.544+00
27191	dash.notesAddSource	{"en": "Value", "he": "ערך", "ru": "Значение"}	2026-06-08 16:12:01.224872+00	2026-07-07 14:00:57.547+00
27188	dash.notesCellDynamic	{"en": "Live value", "he": "ערך חי", "ru": "Живое значение"}	2026-06-08 16:12:01.218292+00	2026-07-07 14:00:57.566+00
27205	dash.notesEmptyCell	{"en": "(empty)", "he": "(ריק)", "ru": "(пусто)"}	2026-06-08 16:12:01.25849+00	2026-07-07 14:00:57.621+00
27195	dash.notesNoRecords	{"en": "No records", "he": "אין רשומות", "ru": "Нет записей"}	2026-06-08 16:12:01.234102+00	2026-07-07 14:00:57.65+00
27206	dash.notesTableEmpty	{"en": "Add rows and columns, then click a cell to configure it.", "he": "הוסף שורות ועמודות, ואז לחץ על תא כדי להגדיר אותו.", "ru": "Добавьте строки и колонки, затем нажмите на ячейку для настройки."}	2026-06-08 16:12:01.261075+00	2026-07-07 14:00:57.687+00
27199	dash.notesRecordNeedsField	{"en": "Select a record and field", "he": "בחר רשומה ושדה", "ru": "Выберите запись и поле"}	2026-06-08 16:12:01.243772+00	2026-07-07 14:00:57.657+00
27204	dash.notesRemoveCol	{"en": "Delete column", "he": "מחק עמודה", "ru": "Удалить колонку"}	2026-06-08 16:12:01.256461+00	2026-07-07 14:00:57.66+00
27236	fields.driveFolder	{"en": "Google Drive folder", "he": "תיקיית Google Drive", "ru": "Папка Google Drive"}	2026-06-08 16:12:01.3326+00	2026-07-07 14:00:58.272+00
27196	dash.notesCellNeedsSource	{"en": "Add at least one value to the cell", "he": "הוסף לפחות ערך אחד לתא", "ru": "Добавьте хотя бы одно значение в ячейку"}	2026-06-08 16:12:01.236643+00	2026-07-07 14:00:57.57+00
27197	dash.notesCellNeedsSourceShort	{"en": "value…", "he": "ערך…", "ru": "значение…"}	2026-06-08 16:12:01.238821+00	2026-07-07 14:00:57.58+00
27238	fields.driveFolderDefault	{"en": "Default (ERP Uploads)", "he": "ברירת מחדל (ERP Uploads)", "ru": "По умолчанию (ERP Uploads)"}	2026-06-08 16:12:01.337357+00	2026-07-07 14:00:58.275+00
27187	dash.notesCellStatic	{"en": "Text", "he": "טקסט", "ru": "Текст"}	2026-06-08 16:12:01.215686+00	2026-07-07 14:00:57.584+00
27203	dash.notesRemoveRow	{"en": "Delete row", "he": "מחק שורה", "ru": "Удалить строку"}	2026-06-08 16:12:01.254044+00	2026-07-07 14:00:57.663+00
27237	fields.driveFolderHint	{"en": "Where to upload this field's files. Defaults to the main “ERP Uploads” folder.", "he": "היכן להעלות את הקבצים של שדה זה. ברירת המחדל היא התיקייה הראשית «ERP Uploads».", "ru": "Куда загружать файлы этого поля. По умолчанию — основная папка «ERP Uploads»."}	2026-06-08 16:12:01.334514+00	2026-07-07 14:00:58.28+00
27189	dash.notesCellText	{"en": "Cell text", "he": "טקסט התא", "ru": "Текст ячейки"}	2026-06-08 16:12:01.220304+00	2026-07-07 14:00:57.592+00
27194	dash.notesSelectRecord	{"en": "Record", "he": "רשומה", "ru": "Запись"}	2026-06-08 16:12:01.232056+00	2026-07-07 14:00:57.666+00
27192	dash.notesSourceMetric	{"en": "Entity aggregate", "he": "צבירת ישות", "ru": "Агрегат сущности"}	2026-06-08 16:12:01.227346+00	2026-07-07 14:00:57.67+00
27184	dash.notesColor	{"en": "Text color", "he": "צבע טקסט", "ru": "Цвет текста"}	2026-06-08 16:12:01.208789+00	2026-07-07 14:00:57.595+00
27269	fileTrash.title	{"en": "File trash", "he": "סל קבצים", "ru": "Корзина файлов"}	2026-06-08 16:12:01.48063+00	2026-07-07 14:00:59.333+00
27282	fileTrash.deleteForever	{"en": "Delete permanently", "he": "מחיקה לצמיתות", "ru": "Удалить навсегда"}	2026-06-08 16:12:01.511644+00	2026-07-07 14:00:59.285+00
27291	gdrive.folderDeleted	{"en": "Folder removed from the list", "he": "התיקייה הוסרה מהרשימה", "ru": "Папка удалена из списка"}	2026-06-08 16:12:01.534377+00	2026-07-07 14:00:59.57+00
27286	fileTrash.purgeConfirmTitle	{"en": "Empty the entire trash?", "he": "לרוקן את כל הסל?", "ru": "Очистить всю корзину?"}	2026-06-08 16:12:01.520777+00	2026-07-07 14:00:59.307+00
27285	fileTrash.cancel	{"en": "Cancel", "he": "ביטול", "ru": "Отмена"}	2026-06-08 16:12:01.518251+00	2026-07-07 14:00:59.249+00
27272	fileTrash.col.file	{"en": "File", "he": "קובץ", "ru": "Файл"}	2026-06-08 16:12:01.487881+00	2026-07-07 14:00:59.262+00
27283	fileTrash.deleteConfirmTitle	{"en": "Delete file permanently?", "he": "למחוק את הקובץ לצמיתות?", "ru": "Удалить файл навсегда?"}	2026-06-08 16:12:01.513684+00	2026-07-07 14:00:59.275+00
27261	fileTrash.deleted	{"en": "File permanently deleted", "he": "הקובץ נמחק לצמיתות", "ru": "Файл удалён навсегда"}	2026-06-08 16:12:01.461427+00	2026-07-07 14:00:59.279+00
27281	fileTrash.download	{"en": "Download", "he": "הורדה", "ru": "Скачать"}	2026-06-08 16:12:01.509061+00	2026-07-07 14:00:59.288+00
27267	fileTrash.reason.fieldReplaced	{"en": "File replaced", "he": "הקובץ הוחלף", "ru": "Файл заменён"}	2026-06-08 16:12:01.475675+00	2026-07-07 14:00:59.32+00
27293	gdrive.foldersTitle	{"en": "Upload folders", "he": "תיקיות העלאה", "ru": "Папки загрузок"}	2026-06-08 16:12:01.539294+00	2026-07-07 14:00:59.587+00
27292	gdrive.folderDeleteError	{"en": "Failed to delete folder", "he": "מחיקת התיקייה נכשלה", "ru": "Не удалось удалить папку"}	2026-06-08 16:12:01.53727+00	2026-07-07 14:00:59.573+00
27278	fileTrash.empty	{"en": "Trash is empty", "he": "סל המיחזור ריק", "ru": "Корзина пуста"}	2026-06-08 16:12:01.502573+00	2026-07-07 14:00:59.294+00
27287	fileTrash.purgeConfirmDesc	{"en": "All files in the trash will be permanently removed from storage. This action cannot be undone.", "he": "כל הקבצים בסל יימחקו לצמיתות מהאחסון. לא ניתן לבטל פעולה זו.", "ru": "Все файлы в корзине будут безвозвратно удалены из хранилища. Это действие нельзя отменить."}	2026-06-08 16:12:01.522796+00	2026-07-07 14:00:59.304+00
27279	fileTrash.field	{"en": "Field", "he": "שדה", "ru": "Поле"}	2026-06-08 16:12:01.504353+00	2026-07-07 14:00:59.298+00
33476	fields.fnLower	{"en": "Converts text to lowercase.", "he": "ממיר טקסט לאותיות קטנות.", "ru": "Переводит текст в нижний регистр."}	2026-06-09 08:26:19.285647+00	2026-07-07 14:00:58.652+00
33477	fields.fnLen	{"en": "The number of characters in the text.", "he": "מספר התווים בטקסט.", "ru": "Количество символов в тексте."}	2026-06-09 08:26:19.287952+00	2026-07-07 14:00:58.656+00
33478	fields.fnSigIf	{"en": "if(condition, if_true, if_false)", "he": "if(תנאי, אם_כן, אם_לא)", "ru": "if(условие, если_да, если_нет)"}	2026-06-09 08:26:19.292791+00	2026-07-07 14:00:58.66+00
33479	fields.fnSigRound	{"en": "round(number, digits)", "he": "round(מספר, ספרות)", "ru": "round(число, знаки)"}	2026-06-09 08:26:19.295105+00	2026-07-07 14:00:58.664+00
33480	fields.fnSigMin	{"en": "min(number1, number2, …)", "he": "min(מספר1, מספר2, …)", "ru": "min(число1, число2, …)"}	2026-06-09 08:26:19.298085+00	2026-07-07 14:00:58.668+00
27277	fileTrash.col.actions	{"en": "Actions", "he": "פעולות", "ru": "Действия"}	2026-06-08 16:12:01.499886+00	2026-07-07 14:00:59.252+00
27273	fileTrash.col.origin	{"en": "Origin", "he": "מקור", "ru": "Откуда"}	2026-06-08 16:12:01.489925+00	2026-07-07 14:00:59.265+00
27263	fileTrash.purged	{"en": "Trash emptied", "he": "הסל רוקן", "ru": "Корзина очищена"}	2026-06-08 16:12:01.465958+00	2026-07-07 14:00:59.311+00
27266	fileTrash.reason.fieldCleared	{"en": "Field cleared", "he": "השדה נוקה", "ru": "Поле очищено"}	2026-06-08 16:12:01.473467+00	2026-07-07 14:00:59.317+00
27265	fileTrash.reason.recordDeleted	{"en": "Record deleted", "he": "הרשומה נמחקה", "ru": "Запись удалена"}	2026-06-08 16:12:01.470883+00	2026-07-07 14:00:59.323+00
27280	fileTrash.record	{"en": "Record", "he": "רשומה", "ru": "Запись"}	2026-06-08 16:12:01.506984+00	2026-07-07 14:00:59.326+00
27276	fileTrash.col.deletedAt	{"en": "When", "he": "מתי", "ru": "Когда"}	2026-06-08 16:12:01.497934+00	2026-07-07 14:00:59.256+00
27274	fileTrash.col.reason	{"en": "Reason", "he": "סיבה", "ru": "Причина"}	2026-06-08 16:12:01.493137+00	2026-07-07 14:00:59.268+00
27268	fileTrash.downloadError	{"en": "Failed to download file", "he": "הורדת הקובץ נכשלה", "ru": "Не удалось скачать файл"}	2026-06-08 16:12:01.478565+00	2026-07-07 14:00:59.292+00
27271	fileTrash.purgeAll	{"en": "Empty trash", "he": "רוקן את הסל", "ru": "Очистить корзину"}	2026-06-08 16:12:01.485243+00	2026-07-07 14:00:59.3+00
27289	gdrive.folderCreated	{"en": "Folder created", "he": "התיקייה נוצרה", "ru": "Папка создана"}	2026-06-08 16:12:01.52803+00	2026-07-07 14:00:59.554+00
27290	gdrive.folderCreateError	{"en": "Failed to create folder", "he": "יצירת התיקייה נכשלה", "ru": "Не удалось создать папку"}	2026-06-08 16:12:01.531305+00	2026-07-07 14:00:59.557+00
27262	fileTrash.deleteError	{"en": "Failed to delete file", "he": "מחיקת הקובץ נכשלה", "ru": "Не удалось удалить файл"}	2026-06-08 16:12:01.464046+00	2026-07-07 14:00:59.281+00
27275	fileTrash.col.deletedBy	{"en": "Deleted by", "he": "נמחק על ידי", "ru": "Кто удалил"}	2026-06-08 16:12:01.495256+00	2026-07-07 14:00:59.259+00
27284	fileTrash.deleteConfirmDesc	{"en": "The file will be permanently removed from storage. This action cannot be undone.", "he": "הקובץ יימחק לצמיתות מהאחסון. לא ניתן לבטל פעולה זו.", "ru": "Файл будет безвозвратно удалён из хранилища. Это действие нельзя отменить."}	2026-06-08 16:12:01.516282+00	2026-07-07 14:00:59.272+00
27295	gdrive.folderNamePlaceholder	{"en": "New folder name", "he": "שם התיקייה החדשה", "ru": "Название новой папки"}	2026-06-08 16:12:01.54469+00	2026-07-07 14:00:59.58+00
40401	views.defaultSortError	{"en": "Error saving sorting", "he": "שגיאה בשמירת המיון", "ru": "Ошибка сохранения сортировки"}	2026-06-09 16:34:27.210787+00	2026-07-07 14:01:02.31+00
27183	dash.notesLinkPrompt	{"en": "Link URL (empty to remove)", "he": "כתובת קישור (ריק להסרה)", "ru": "Адрес ссылки (пусто — убрать)"}	2026-06-08 16:12:01.205616+00	2026-07-07 14:00:57.642+00
33488	fields.fnSigLen	{"en": "len(text)", "he": "len(טקסט)", "ru": "len(текст)"}	2026-06-09 08:26:19.319512+00	2026-07-07 14:00:58.698+00
27298	gdrive.folderDefault	{"en": "Default", "he": "ברירת מחדל", "ru": "По умолчанию"}	2026-06-08 16:12:01.552036+00	2026-07-07 14:00:59.56+00
28135	dash.edit	{"en": "Edit", "he": "עריכה", "ru": "Редактировать"}	2026-06-08 16:43:28.117087+00	2026-07-07 14:00:57.315+00
28136	dash.noRoles	{"en": "No roles", "he": "אין תפקידים", "ru": "Нет ролей"}	2026-06-08 16:43:28.119867+00	2026-07-07 14:00:57.538+00
27296	gdrive.folderAdd	{"en": "Create", "he": "יצירה", "ru": "Создать"}	2026-06-08 16:12:01.547465+00	2026-07-07 14:00:59.55+00
27303	gdrive.folderDeleteAction	{"en": "Delete", "he": "מחיקה", "ru": "Удалить"}	2026-06-08 16:12:01.563375+00	2026-07-07 14:00:59.563+00
27301	gdrive.folderDeleteTitle	{"en": "Remove folder from the list?", "he": "להסיר את התיקייה מהרשימה?", "ru": "Удалить папку из списка?"}	2026-06-08 16:12:01.558655+00	2026-07-07 14:00:59.576+00
27299	gdrive.subfolderAdd	{"en": "Create subfolder", "he": "יצירת תיקיית משנה", "ru": "Создать подпапку"}	2026-06-08 16:12:01.554044+00	2026-07-07 14:00:59.806+00
27300	gdrive.subfolderPlaceholder	{"en": "Subfolder name", "he": "שם תיקיית המשנה", "ru": "Название подпапки"}	2026-06-08 16:12:01.556564+00	2026-07-07 14:00:59.809+00
42336	roles.cardAdmin	{"en": "Administration", "he": "ניהול", "ru": "Администрирование"}	2026-06-10 11:05:22.005075+00	2026-07-07 14:01:01.511+00
42337	roles.cardNoPerms	{"en": "No permissions assigned", "he": "לא הוקצו הרשאות", "ru": "Права не назначены"}	2026-06-10 11:05:22.00795+00	2026-07-07 14:01:01.514+00
42338	roles.scopeOwnShort	{"en": "own", "he": "שלו", "ru": "свои"}	2026-06-10 11:05:22.011252+00	2026-07-07 14:01:01.518+00
27200	dash.notesFormulaHint	{"en": "Combine values by key: {s1}. Without a formula the first value is shown.", "he": "שלב ערכים לפי מפתח: {s1}. ללא נוסחה מוצג הערך הראשון.", "ru": "Комбинируйте значения по ключу: {s1}. Без формулы показывается первое значение."}	2026-06-08 16:12:01.247218+00	2026-07-07 14:00:57.627+00
33481	fields.fnSigMax	{"en": "max(number1, number2, …)", "he": "max(מספר1, מספר2, …)", "ru": "max(число1, число2, …)"}	2026-06-09 08:26:19.300543+00	2026-07-07 14:00:58.672+00
33482	fields.fnSigSum	{"en": "sum(number1, number2, …)", "he": "sum(מספר1, מספר2, …)", "ru": "sum(число1, число2, …)"}	2026-06-09 08:26:19.303203+00	2026-07-07 14:00:58.675+00
33483	fields.fnSigAbs	{"en": "abs(number)", "he": "abs(מספר)", "ru": "abs(число)"}	2026-06-09 08:26:19.305518+00	2026-07-07 14:00:58.678+00
33484	fields.fnSigConcat	{"en": "concat(value1, value2, …)", "he": "concat(ערך1, ערך2, …)", "ru": "concat(значение1, значение2, …)"}	2026-06-09 08:26:19.307819+00	2026-07-07 14:00:58.682+00
33485	fields.fnSigCoalesce	{"en": "coalesce(value1, value2, …)", "he": "coalesce(ערך1, ערך2, …)", "ru": "coalesce(значение1, значение2, …)"}	2026-06-09 08:26:19.310667+00	2026-07-07 14:00:58.687+00
33489	records.openInDrive	{"en": "Open in Google Drive", "he": "פתח ב-Google Drive", "ru": "Открыть в Google Drive"}	2026-06-09 08:26:19.32278+00	2026-07-07 14:00:58.702+00
27297	gdrive.noFolders	{"en": "No folders yet.", "he": "אין תיקיות עדיין.", "ru": "Папок пока нет."}	2026-06-08 16:12:01.549595+00	2026-07-07 14:00:59.605+00
31957	roles.overrideRights	{"en": "Override rights", "he": "עקוף הרשאות", "ru": "Переопределить права"}	2026-06-09 08:09:30.758457+00	2026-07-07 14:01:01.637+00
40398	views.defaultSortDialogDesc	{"en": "This sorting is applied to records when no view is selected. A selected view uses its own sorting.", "he": "מיון זה מוחל על רשומות כאשר לא נבחרה תצוגה. תצוגה נבחרת משתמשת במיון משלה.", "ru": "Эта сортировка применяется к записям, когда вид не выбран. Выбранный вид использует свою собственную сортировку."}	2026-06-09 16:34:27.19974+00	2026-07-07 14:01:02.301+00
33490	records.auditStatus	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-06-09 08:26:19.32564+00	2026-07-07 14:00:58.706+00
33491	records.auditArchived	{"en": "Archive", "he": "ארכיון", "ru": "Архив"}	2026-06-09 08:26:19.328326+00	2026-07-07 14:00:58.711+00
33492	records.auditCreated	{"en": "Record created", "he": "הרשומה נוצרה", "ru": "Запись создана"}	2026-06-09 08:26:19.330877+00	2026-07-07 14:00:58.714+00
33493	records.auditDeleted	{"en": "Record deleted", "he": "הרשומה נמחקה", "ru": "Запись удалена"}	2026-06-09 08:26:19.333986+00	2026-07-07 14:00:58.717+00
27270	fileTrash.subtitle	{"en": "Local files removed from records. They can be downloaded for recovery or deleted permanently. Google Drive files are not stored here.", "he": "קבצים מקומיים שהוסרו מרשומות. ניתן להוריד אותם לשחזור או למחוק לצמיתות. קבצי Google Drive אינם נשמרים כאן.", "ru": "Локальные файлы, удалённые из записей. Их можно скачать для восстановления или удалить навсегда. Файлы Google Drive здесь не хранятся."}	2026-06-08 16:12:01.483181+00	2026-07-07 14:00:59.33+00
33486	fields.fnSigUpper	{"en": "upper(text)", "he": "upper(טקסט)", "ru": "upper(текст)"}	2026-06-09 08:26:19.314019+00	2026-07-07 14:00:58.69+00
33487	fields.fnSigLower	{"en": "lower(text)", "he": "lower(טקסט)", "ru": "lower(текст)"}	2026-06-09 08:26:19.316975+00	2026-07-07 14:00:58.694+00
40399	views.defaultSortNone	{"en": "By creation date (newest first)", "he": "לפי תאריך יצירה (החדשים תחילה)", "ru": "По дате создания (сначала новые)"}	2026-06-09 16:34:27.204457+00	2026-07-07 14:01:02.304+00
40400	views.defaultSortSaved	{"en": "Default sorting saved", "he": "מיון ברירת המחדל נשמר", "ru": "Сортировка по умолчанию сохранена"}	2026-06-09 16:34:27.207389+00	2026-07-07 14:01:02.307+00
28552	relations.keyAutoPlaceholder	{"en": "Generated automatically", "he": "ייווצר אוטומטית", "ru": "Сгенерируется автоматически"}	2026-06-08 19:51:36.120369+00	2026-07-07 14:01:01.38+00
28548	statuses.keyAutoPlaceholder	{"en": "Generated automatically", "he": "ייווצר אוטומטית", "ru": "Сгенерируется автоматически"}	2026-06-08 19:51:36.107222+00	2026-07-07 14:01:01.957+00
54792	fields.relationHint	{"en": "A related field shows a value from the single linked record. One-to-one and many-to-one relations are available (as well as the one-to-many inverse side).", "he": "שדה מקושר מציג ערך מהרשומה המקושרת היחידה. זמינים קשרי אחד-לאחד ורבים-לאחד (וגם הצד ההפוך של אחד-לרבים).", "ru": "Связанное поле показывает значение из единственной связанной записи. Доступны связи «один к одному» и «многие к одному» (а также обратная сторона «один ко многим»)."}	2026-06-12 07:03:22.562879+00	2026-07-07 14:01:02.712+00
41445	users.roleRequired	{"en": "Select a primary role", "he": "בחר תפקיד ראשי", "ru": "Выберите основную роль"}	2026-06-09 16:41:21.548303+00	2026-07-07 14:01:02.258+00
54793	fields.relationPlaceholder	{"en": "Select a relation", "he": "בחרו קשר", "ru": "Выберите связь"}	2026-06-12 07:03:22.566414+00	2026-07-07 14:01:02.715+00
57094	records.mirrorLabelTitle	{"en": "Field header on this page", "he": "כותרת השדה בעמוד זה", "ru": "Заголовок поля на этой странице"}	2026-06-17 16:03:44.502524+00	2026-07-07 14:01:03.137+00
58286	pivot.modeTable	{"en": "Table", "he": "טבלה", "ru": "Таблица"}	2026-06-18 14:19:33.396468+00	2026-07-07 14:01:02.926+00
55065	fields.fileSourceDefault	{"en": "default", "he": "ברירת מחדל", "ru": "по умолчанию"}	2026-06-13 19:23:04.677743+00	2026-07-07 14:00:58.487+00
29529	modules.keyAutoPlaceholder	{"en": "Generated automatically", "he": "ייווצר אוטומטית", "ru": "Сгенерируется автоматически"}	2026-06-08 19:52:40.520907+00	2026-07-07 14:01:00.08+00
29530	modules.keyHintAuto	{"en": "Optional. If left empty, the key is generated automatically from the name. Only lowercase latin letters, digits and underscores.", "he": "אופציונלי. אם יישאר ריק, המפתח ייווצר אוטומטית מהשם. רק אותיות לטיניות קטנות, ספרות וקו תחתון.", "ru": "Необязательно. Если оставить пустым, ключ будет создан автоматически из названия. Только строчные латинские буквы, цифры и подчёркивания."}	2026-06-08 19:52:40.523391+00	2026-07-07 14:01:00.086+00
28553	relations.keyHintAuto	{"en": "Optional. If left empty, the key is generated automatically from the name. Only lowercase latin letters, digits and underscores. Unique within the entity.", "he": "אופציונלי. אם יישאר ריק, המפתח ייווצר אוטומטית מהשם. רק אותיות לטיניות קטנות, ספרות וקו תחתון. ייחודי בתוך הישות.", "ru": "Необязательно. Если оставить пустым, ключ будет создан автоматически из названия. Только строчные латинские буквы, цифры и подчёркивания. Уникален в пределах сущности."}	2026-06-08 19:51:36.122993+00	2026-07-07 14:01:01.384+00
54794	fields.noRelations	{"en": "No suitable relations for this entity.", "he": "אין קשרים מתאימים לישות זו.", "ru": "Нет подходящих связей для этой сущности."}	2026-06-12 07:03:22.56904+00	2026-07-07 14:01:02.719+00
58287	pivot.needColField	{"en": "Select the pivot column field", "he": "בחר את שדה עמודות הציר", "ru": "Выберите поле столбцов сводной таблицы"}	2026-06-18 14:19:33.400728+00	2026-07-07 14:01:02.93+00
28549	statuses.keyHintAuto	{"en": "Optional. If left empty, the key is generated automatically from the name. Only lowercase latin letters, digits and underscores. Unique within the entity.", "he": "אופציונלי. אם יישאר ריק, המפתח ייווצר אוטומטית מהשם. רק אותיות לטיניות קטנות, ספרות וקו תחתון. ייחודי בתוך הישות.", "ru": "Необязательно. Если оставить пустым, ключ будет создан автоматически из названия. Только строчные латинские буквы, цифры и подчёркивания. Уникален в пределах сущности."}	2026-06-08 19:51:36.111222+00	2026-07-07 14:01:01.96+00
28550	views.keyAutoPlaceholder	{"en": "Generated automatically", "he": "ייווצר אוטומטית", "ru": "Сгенерируется автоматически"}	2026-06-08 19:51:36.113738+00	2026-07-07 14:01:02.381+00
58285	pivot.modePivot	{"en": "Pivot", "he": "ציר", "ru": "Сводная"}	2026-06-18 14:19:33.392516+00	2026-07-07 14:01:02.923+00
57092	records.mirrorLabelEdit	{"en": "Rename header on this page", "he": "שנה שם כותרת בעמוד זה", "ru": "Переименовать заголовок на этой странице"}	2026-06-17 16:03:44.496473+00	2026-07-07 14:01:03.12+00
34528	dash.notesResizeTip	{"en": "Drag to resize the column (double-click to reset)", "he": "גרור לשינוי רוחב העמודה (לחיצה כפולה לאיפוס)", "ru": "Потяните, чтобы изменить ширину колонки (двойной клик — сбросить)"}	2026-06-09 08:32:07.13995+00	2026-07-07 14:00:58.857+00
28551	views.keyHintAuto	{"en": "Optional. If left empty, the key is generated automatically from the name. Only lowercase latin letters, digits and underscores. Unique within the entity.", "he": "אופציונלי. אם יישאר ריק, המפתח ייווצר אוטומטית מהשם. רק אותיות לטיניות קטנות, ספרות וקו תחתון. ייחודי בתוך הישות.", "ru": "Необязательно. Если оставить пустым, ключ будет создан автоматически из названия. Только строчные латинские буквы, цифры и подчёркивания. Уникален в пределах сущности."}	2026-06-08 19:51:36.116644+00	2026-07-07 14:01:02.388+00
34520	trans.notFound	{"en": "No translations found", "he": "לא נמצאו תרגומים", "ru": "Переводы не найдены"}	2026-06-09 08:32:07.120569+00	2026-07-07 14:00:58.833+00
34521	trans.editTitle	{"en": "Edit translation", "he": "עריכת תרגום", "ru": "Редактировать перевод"}	2026-06-09 08:32:07.122731+00	2026-07-07 14:00:58.836+00
32495	fields.op.contains	{"en": "contains", "he": "מכיל", "ru": "содержит"}	2026-06-09 08:16:58.916722+00	2026-07-07 14:00:58.995+00
42332	roles.capShort.googleDrive	{"en": "Google Drive", "he": "Google Drive", "ru": "Google Drive"}	2026-06-10 11:05:21.992806+00	2026-07-07 14:01:01.497+00
34522	trans.newTitle	{"en": "New translation", "he": "תרגום חדש", "ru": "Новый перевод"}	2026-06-09 08:32:07.125101+00	2026-07-07 14:00:58.84+00
34523	trans.keyLabel	{"en": "Key *", "he": "מפתח *", "ru": "Ключ *"}	2026-06-09 08:32:07.127143+00	2026-07-07 14:00:58.843+00
34525	trans.added	{"en": "Translation added", "he": "התרגום נוסף", "ru": "Перевод добавлен"}	2026-06-09 08:32:07.132496+00	2026-07-07 14:00:58.848+00
34526	trans.errorExists	{"en": "Error: key already exists", "he": "שגיאה: המפתח כבר קיים", "ru": "Ошибка: ключ уже существует"}	2026-06-09 08:32:07.135079+00	2026-07-07 14:00:58.852+00
32496	fields.op.empty	{"en": "empty", "he": "ריק", "ru": "пусто"}	2026-06-09 08:16:58.919798+00	2026-07-07 14:00:58.999+00
32498	fields.op.gt	{"en": "greater than", "he": "גדול מ", "ru": "больше"}	2026-06-09 08:16:58.924633+00	2026-07-07 14:00:59.005+00
32499	fields.op.gte	{"en": "greater or equal", "he": "גדול או שווה", "ru": "больше или равно"}	2026-06-09 08:16:58.92742+00	2026-07-07 14:00:59.007+00
32500	fields.op.lt	{"en": "less than", "he": "קטן מ", "ru": "меньше"}	2026-06-09 08:16:58.930189+00	2026-07-07 14:00:59.01+00
32502	fields.op.notContains	{"en": "does not contain", "he": "לא מכיל", "ru": "не содержит"}	2026-06-09 08:16:58.935331+00	2026-07-07 14:00:59.021+00
32503	fields.op.notEmpty	{"en": "not empty", "he": "לא ריק", "ru": "не пусто"}	2026-06-09 08:16:58.938431+00	2026-07-07 14:00:59.024+00
32504	fields.op.notEquals	{"en": "not equal", "he": "לא שווה", "ru": "не равно"}	2026-06-09 08:16:58.941161+00	2026-07-07 14:00:59.027+00
42328	roles.capShort.users	{"en": "Users", "he": "משתמשים", "ru": "Пользователи"}	2026-06-10 11:05:21.979834+00	2026-07-07 14:01:01.483+00
42329	roles.capShort.translations	{"en": "Translations", "he": "תרגומים", "ru": "Переводы"}	2026-06-10 11:05:21.982761+00	2026-07-07 14:01:01.488+00
42330	roles.capShort.events	{"en": "Events", "he": "אירועים", "ru": "События"}	2026-06-10 11:05:21.986242+00	2026-07-07 14:01:01.491+00
42333	roles.capShort.settings	{"en": "Settings", "he": "הגדרות", "ru": "Настройки"}	2026-06-10 11:05:21.995615+00	2026-07-07 14:01:01.501+00
42334	roles.cardData	{"en": "Data", "he": "נתונים", "ru": "Данные"}	2026-06-10 11:05:21.998854+00	2026-07-07 14:01:01.504+00
34518	trans.colKey	{"en": "Key", "he": "מפתח", "ru": "Ключ"}	2026-06-09 08:32:07.115559+00	2026-07-07 14:00:58.827+00
34513	trans.title	{"en": "Translations", "he": "תרגומים", "ru": "Переводы"}	2026-06-09 08:32:07.100635+00	2026-07-07 14:00:58.72+00
34514	trans.subtitle	{"en": "Manage multilingual content (ru/en/he)", "he": "ניהול תוכן רב-לשוני (ru/en/he)", "ru": "Управление многоязычным контентом (ru/en/he)"}	2026-06-09 08:32:07.103363+00	2026-07-07 14:00:58.723+00
34515	trans.add	{"en": "Add translation", "he": "הוסף תרגום", "ru": "Добавить перевод"}	2026-06-09 08:32:07.106071+00	2026-07-07 14:00:58.727+00
34516	trans.searchPlaceholder	{"en": "Search by key or text...", "he": "חיפוש לפי מפתח או טקסט...", "ru": "Поиск по ключу или тексту..."}	2026-06-09 08:32:07.109383+00	2026-07-07 14:00:58.735+00
34517	trans.onlyUntranslated	{"en": "Untranslated only", "he": "לא מתורגמים בלבד", "ru": "Только непереведённые"}	2026-06-09 08:32:07.112149+00	2026-07-07 14:00:58.738+00
34519	trans.colActions	{"en": "Actions", "he": "פעולות", "ru": "Действия"}	2026-06-09 08:32:07.117568+00	2026-07-07 14:00:58.83+00
34524	trans.create	{"en": "Add", "he": "הוסף", "ru": "Добавить"}	2026-06-09 08:32:07.130464+00	2026-07-07 14:00:58.845+00
34527	trans.updated	{"en": "Translation updated", "he": "התרגום עודכן", "ru": "Перевод обновлён"}	2026-06-09 08:32:07.137455+00	2026-07-07 14:00:58.855+00
32497	fields.op.equals	{"en": "equals", "he": "שווה", "ru": "равно"}	2026-06-09 08:16:58.922465+00	2026-07-07 14:00:59.002+00
32501	fields.op.lte	{"en": "less or equal", "he": "קטן או שווה", "ru": "меньше или равно"}	2026-06-09 08:16:58.932988+00	2026-07-07 14:00:59.015+00
42331	roles.capShort.modules	{"en": "Modules", "he": "מודולים", "ru": "Модули"}	2026-06-10 11:05:21.989021+00	2026-07-07 14:01:01.494+00
42335	roles.cardPages	{"en": "Pages", "he": "דפים", "ru": "Страницы"}	2026-06-10 11:05:22.001694+00	2026-07-07 14:01:01.507+00
33468	fields.fnRound	{"en": "Rounds a number to the given number of decimal places.", "he": "מעגל מספר למספר הספרות העשרוניות שצוין.", "ru": "Округляет число до указанного количества знаков после запятой."}	2026-06-09 08:26:19.265367+00	2026-07-07 14:00:58.504+00
33471	fields.fnSum	{"en": "The sum of all listed values.", "he": "סכום כל הערכים המפורטים.", "ru": "Сумма всех перечисленных значений."}	2026-06-09 08:26:19.273143+00	2026-07-07 14:00:58.634+00
33472	fields.fnAbs	{"en": "The absolute value (modulus) of a number.", "he": "הערך המוחלט של מספר.", "ru": "Абсолютное значение (модуль) числа."}	2026-06-09 08:26:19.275703+00	2026-07-07 14:00:58.638+00
33473	fields.fnConcat	{"en": "Joins values into a single string.", "he": "מחבר ערכים למחרוזת אחת.", "ru": "Объединяет значения в одну строку."}	2026-06-09 08:26:19.277812+00	2026-07-07 14:00:58.642+00
33474	fields.fnCoalesce	{"en": "The first non-empty value from those listed.", "he": "הערך הראשון שאינו ריק מבין המפורטים.", "ru": "Первое непустое значение из перечисленных."}	2026-06-09 08:26:19.281174+00	2026-07-07 14:00:58.645+00
33475	fields.fnUpper	{"en": "Converts text to UPPERCASE.", "he": "ממיר טקסט לאותיות גדולות.", "ru": "Переводит текст в ВЕРХНИЙ регистр."}	2026-06-09 08:26:19.28336+00	2026-07-07 14:00:58.648+00
33469	fields.fnMin	{"en": "The smallest of the listed values.", "he": "הקטן מבין הערכים המפורטים.", "ru": "Наименьшее из перечисленных значений."}	2026-06-09 08:26:19.267339+00	2026-07-07 14:00:58.627+00
33470	fields.fnMax	{"en": "The largest of the listed values.", "he": "הגדול מבין הערכים המפורטים.", "ru": "Наибольшее из перечисленных значений."}	2026-06-09 08:26:19.27062+00	2026-07-07 14:00:58.63+00
39285	users.additionalRolesHint	{"en": "Permissions are combined across all roles (the most permissive access wins).", "he": "ההרשאות משולבות מכל התפקידים (הגישה המתירנית ביותר גוברת).", "ru": "Права суммируются по всем ролям (выбирается наиболее разрешающий доступ)."}	2026-06-09 16:12:55.01295+00	2026-07-07 14:01:02.019+00
39286	users.primaryRoleTag	{"en": "primary", "he": "ראשי", "ru": "основная"}	2026-06-09 16:12:55.016128+00	2026-07-07 14:01:02.022+00
42325	roles.capShort.pages	{"en": "Pages", "he": "דפים", "ru": "Страницы"}	2026-06-10 11:05:21.968503+00	2026-07-07 14:01:01.471+00
42326	roles.capShort.entities	{"en": "Entities", "he": "ישויות", "ru": "Сущности"}	2026-06-10 11:05:21.97334+00	2026-07-07 14:01:01.475+00
42327	roles.capShort.roles	{"en": "Roles", "he": "תפקידים", "ru": "Роли"}	2026-06-10 11:05:21.97638+00	2026-07-07 14:01:01.479+00
36046	roles.statusRights	{"en": "Status rights", "he": "הרשאות סטטוס", "ru": "Права на статусы"}	2026-06-09 08:50:23.355296+00	2026-07-07 14:01:01.662+00
36048	roles.statusSelectEntity	{"en": "Select entity", "he": "בחר ישות", "ru": "Выберите сущность"}	2026-06-09 08:50:23.360348+00	2026-07-07 14:01:01.669+00
36049	roles.statusAllAdded	{"en": "All entities added", "he": "כל הישויות נוספו", "ru": "Все сущности добавлены"}	2026-06-09 08:50:23.36315+00	2026-07-07 14:01:01.671+00
36050	roles.addStatusRights	{"en": "Add status rights", "he": "הוסף הרשאות סטטוס", "ru": "Добавить права на статусы"}	2026-06-09 08:50:23.365452+00	2026-07-07 14:01:01.675+00
36051	roles.statusNone	{"en": "The entity has no statuses.", "he": "לישות אין סטטוסים.", "ru": "У сущности нет статусов."}	2026-06-09 08:50:23.368369+00	2026-07-07 14:01:01.683+00
37202	users.passwordTooShort	{"en": "Password must be at least 6 characters", "he": "הסיסמה חייבת להכיל לפחות 6 תווים", "ru": "Пароль должен содержать минимум 6 символов"}	2026-06-09 15:26:28.423371+00	2026-07-07 14:01:02.067+00
40393	views.ascShort	{"en": "↑", "he": "↑", "ru": "↑"}	2026-06-09 16:34:27.183272+00	2026-07-07 14:01:02.285+00
40394	views.descShort	{"en": "↓", "he": "↓", "ru": "↓"}	2026-06-09 16:34:27.18708+00	2026-07-07 14:01:02.288+00
40395	views.configure	{"en": "Configure", "he": "הגדרה", "ru": "Настроить"}	2026-06-09 16:34:27.189935+00	2026-07-07 14:01:02.29+00
36052	roles.statusName	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-06-09 08:50:23.37037+00	2026-07-07 14:01:01.686+00
40396	views.defaultSortTitle	{"en": "Default sorting", "he": "מיון ברירת מחדל", "ru": "Сортировка по умолчанию"}	2026-06-09 16:34:27.193214+00	2026-07-07 14:01:02.294+00
36053	roles.statusShow	{"en": "Show status", "he": "הצג סטטוס", "ru": "Отображать статус"}	2026-06-09 08:50:23.373358+00	2026-07-07 14:01:01.69+00
37354	common.showPassword	{"en": "Show password", "he": "הצג סיסמה", "ru": "Показать пароль"}	2026-06-09 15:34:29.564459+00	2026-07-07 14:00:57.178+00
37355	common.hidePassword	{"en": "Hide password", "he": "הסתר סיסמה", "ru": "Скрыть пароль"}	2026-06-09 15:34:29.579828+00	2026-07-07 14:00:57.183+00
28137	dash.notesEditableRoles	{"en": "Who can edit the content", "he": "מי יכול לערוך את התוכן", "ru": "Кто может редактировать содержимое"}	2026-06-08 16:43:28.121956+00	2026-07-07 14:00:57.601+00
27294	gdrive.foldersHint	{"en": "Create folders in Google Drive to distribute uploads among them. Each file field can be linked to its own folder. Deleting removes the folder from the list, but the folder itself remains in Google Drive.", "he": "צרו תיקיות ב-Google Drive שביניהן יחולקו ההעלאות. ניתן לקשר כל שדה קובץ לתיקייה משלו. המחיקה מסירה את התיקייה מהרשימה, אך התיקייה עצמה נשארת ב-Google Drive.", "ru": "Создавайте папки в Google Drive, между которыми распределяются загрузки. Каждое поле-файл можно привязать к своей папке. Удаление убирает папку из списка, но сама папка в Google Drive остаётся."}	2026-06-08 16:12:01.542345+00	2026-07-07 14:00:59.584+00
36054	roles.statusShowRows	{"en": "Show rows", "he": "הצג שורות", "ru": "Отображать строки"}	2026-06-09 08:50:23.37533+00	2026-07-07 14:01:01.693+00
39283	users.primaryRole	{"en": "Primary role", "he": "תפקיד ראשי", "ru": "Основная роль"}	2026-06-09 16:12:55.006422+00	2026-07-07 14:01:02.014+00
39284	users.additionalRoles	{"en": "Additional roles", "he": "תפקידים נוספים", "ru": "Дополнительные роли"}	2026-06-09 16:12:55.010285+00	2026-07-07 14:01:02.016+00
54795	fields.relatedField	{"en": "Related entity field", "he": "שדה של הישות המקושרת", "ru": "Поле связанной сущности"}	2026-06-12 07:03:22.572238+00	2026-07-07 14:01:02.722+00
45196	fields.userAllowCreate	{"en": "Allow creating new users", "he": "אפשר יצירת משתמשים חדשים", "ru": "Разрешить создание новых пользователей"}	2026-06-10 12:35:39.830122+00	2026-07-07 14:00:59.239+00
43421	roles.filterByStatus	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-06-10 11:14:07.790816+00	2026-07-07 14:01:01.543+00
43424	roles.filterReset	{"en": "Reset", "he": "איפוס", "ru": "Сбросить"}	2026-06-10 11:14:07.800049+00	2026-07-07 14:01:01.551+00
40397	views.defaultSortDesc	{"en": "Applied when no view is selected. Without configuration — by creation date (newest first).", "he": "מוחל כאשר לא נבחר תצוגה. ללא הגדרה — לפי תאריך יצירה (החדשים תחילה).", "ru": "Применяется, когда вид не выбран. Без настройки — по дате создания (сначала новые)."}	2026-06-09 16:34:27.195945+00	2026-07-07 14:01:02.298+00
67392	auto.skipped	{"en": "Skipped", "he": "דולג", "ru": "Пропущено"}	2026-06-19 07:26:25.227069+00	2026-07-07 14:01:03.644+00
67393	auto.deleteTitle	{"en": "Delete automation?", "he": "למחוק אוטומציה?", "ru": "Удалить автоматизацию?"}	2026-06-19 07:26:25.230768+00	2026-07-07 14:01:03.648+00
67395	auto.created	{"en": "Automation created", "he": "האוטומציה נוצרה", "ru": "Автоматизация создана"}	2026-06-19 07:26:25.237772+00	2026-07-07 14:01:03.654+00
67396	auto.createError	{"en": "Creation error", "he": "שגיאת יצירה", "ru": "Ошибка создания"}	2026-06-19 07:26:25.241074+00	2026-07-07 14:01:03.656+00
67398	auto.updateError	{"en": "Update error", "he": "שגיאת עדכון", "ru": "Ошибка обновления"}	2026-06-19 07:26:25.247335+00	2026-07-07 14:01:03.663+00
44330	records.colPermsBadge	{"en": "Custom access", "he": "הרשאות מותאמות", "ru": "Особые права"}	2026-06-10 11:23:21.235403+00	2026-07-07 14:01:00.524+00
43414	roles.cardMirror	{"en": "Mirror pages", "he": "דפי מראה", "ru": "Зеркальные страницы"}	2026-06-10 11:14:07.767093+00	2026-07-07 14:01:01.521+00
43415	roles.cardStatusHidden	{"en": "Hidden statuses", "he": "סטטוסים מוסתרים", "ru": "Статусы скрыты"}	2026-06-10 11:14:07.770948+00	2026-07-07 14:01:01.524+00
33467	fields.fnIf	{"en": "Returns the second argument if the condition is true, otherwise the third.", "he": "מחזיר את הארגומנט השני אם התנאי נכון, אחרת את השלישי.", "ru": "Возвращает второй аргумент, если условие истинно, иначе третий."}	2026-06-09 08:26:19.263056+00	2026-07-07 14:00:58.501+00
27302	gdrive.folderDeleteConfirm	{"en": "The folder and all its subfolders will no longer be available for new uploads. The folders and files in Google Drive themselves are not deleted. Fields linked to them will start using the default folder.", "he": "התיקייה וכל תיקיות המשנה שלה לא יהיו זמינות יותר להעלאות חדשות. התיקיות והקבצים ב-Google Drive עצמם אינם נמחקים. שדות המקושרים אליהן יתחילו להשתמש בתיקיית ברירת המחדל.", "ru": "Папка и все её подпапки перестанут быть доступными для новых загрузок. Сами папки и файлы в Google Drive не удаляются. Поля, привязанные к ним, начнут использовать папку по умолчанию."}	2026-06-08 16:12:01.561343+00	2026-07-07 14:00:59.567+00
44331	records.colPermsTitle	{"en": "Access by role", "he": "הרשאות לפי תפקיד", "ru": "Права доступа по ролям"}	2026-06-10 11:23:21.238759+00	2026-07-07 14:01:00.528+00
43417	roles.filterByPage	{"en": "Page", "he": "דף", "ru": "Страница"}	2026-06-10 11:14:07.778035+00	2026-07-07 14:01:01.531+00
43418	roles.filterAllPages	{"en": "All pages", "he": "כל הדפים", "ru": "Все страницы"}	2026-06-10 11:14:07.78067+00	2026-07-07 14:01:01.533+00
43419	roles.filterByEntity	{"en": "Entity", "he": "ישות", "ru": "Сущность"}	2026-06-10 11:14:07.784373+00	2026-07-07 14:01:01.537+00
43422	roles.filterAllStatuses	{"en": "All statuses", "he": "כל הסטטוסים", "ru": "Все статусы"}	2026-06-10 11:14:07.793709+00	2026-07-07 14:01:01.546+00
43423	roles.filterStatusPlaceholder	{"en": "Select an entity first", "he": "בחר ישות תחילה", "ru": "Сначала выберите сущность"}	2026-06-10 11:14:07.797219+00	2026-07-07 14:01:01.548+00
43425	roles.filterEmpty	{"en": "No roles match the filter", "he": "אין תפקידים התואמים את הסינון", "ru": "Нет ролей по выбранному фильтру"}	2026-06-10 11:14:07.803214+00	2026-07-07 14:01:01.554+00
45752	users.fieldsRequired	{"en": "Fill in first name, last name and email", "he": "מלא שם פרטי, שם משפחה ואימייל", "ru": "Заполните имя, фамилию и email"}	2026-06-10 12:35:41.811347+00	2026-07-07 14:01:02.057+00
67389	auto.runStatus	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-06-19 07:26:25.217009+00	2026-07-07 14:01:03.633+00
67390	auto.success	{"en": "Success", "he": "הצלחה", "ru": "Успешно"}	2026-06-19 07:26:25.220125+00	2026-07-07 14:01:03.636+00
67394	auto.deleteDesc	{"en": "This action cannot be undone.", "he": "פעולה זו אינה הפיכה.", "ru": "Действие необратимо."}	2026-06-19 07:26:25.233729+00	2026-07-07 14:01:03.65+00
67397	auto.updated	{"en": "Automation updated", "he": "האוטומציה עודכנה", "ru": "Автоматизация обновлена"}	2026-06-19 07:26:25.24442+00	2026-07-07 14:01:03.66+00
45524	records.addNewUser	{"en": "Add a new user", "he": "הוסף משתמש חדש", "ru": "Добавить нового пользователя"}	2026-06-10 12:35:41.007707+00	2026-07-07 14:01:01.267+00
43416	roles.cardRowsHidden	{"en": "Hidden rows", "he": "שורות מוסתרות", "ru": "Строки скрыты"}	2026-06-10 11:14:07.773816+00	2026-07-07 14:01:01.528+00
43420	roles.filterAllEntities	{"en": "All entities", "he": "כל הישויות", "ru": "Все сущности"}	2026-06-10 11:14:07.787487+00	2026-07-07 14:01:01.54+00
67391	auto.error	{"en": "Error", "he": "שגיאה", "ru": "Ошибка"}	2026-06-19 07:26:25.223252+00	2026-07-07 14:01:03.639+00
47622	records.depMergeConfirm	{"en": "A value with this name already exists. Merge the records?", "he": "ערך בשם זה כבר קיים. למזג את הרשומות?", "ru": "Значение с таким названием уже существует. Объединить записи?"}	2026-06-10 14:14:36.161447+00	2026-07-07 14:01:00.569+00
52300	settings.defaultLanguage	{"en": "Default language", "he": "שפת ברירת מחדל", "ru": "Язык по умолчанию"}	2026-06-10 20:05:17.000114+00	2026-07-07 14:01:01.74+00
52301	settings.defaultLanguageHint	{"en": "Interface language for new users and those who haven't chosen a language yet.", "he": "שפת הממשק למשתמשים חדשים ולמי שעדיין לא בחר שפה.", "ru": "Язык интерфейса для новых пользователей и тех, кто ещё не выбрал язык."}	2026-06-10 20:05:17.003165+00	2026-07-07 14:01:01.743+00
49164	views.sortSysId	{"en": "Record ID (system)", "he": "מזהה רשומה (מערכת)", "ru": "ID записи (системный)"}	2026-06-10 14:26:29.334264+00	2026-07-07 14:01:02.506+00
54790	fields.type.relation	{"en": "Related field", "he": "שדה מקושר", "ru": "Связанное поле"}	2026-06-12 07:03:22.552883+00	2026-07-07 14:01:02.702+00
54791	fields.relation	{"en": "Relation", "he": "קשר", "ru": "Связь"}	2026-06-12 07:03:22.560067+00	2026-07-07 14:01:02.709+00
54798	records.numberDotHint	{"en": "Use a dot as the decimal separator, e.g. 11.6", "he": "השתמש בנקודה כמפריד עשרוני, לדוגמה 11.6", "ru": "Используйте точку как десятичный разделитель, например 11.6"}	2026-06-12 07:03:22.580895+00	2026-07-07 14:01:03.14+00
54796	fields.relatedFieldPlaceholder	{"en": "Select a field", "he": "בחרו שדה", "ru": "Выберите поле"}	2026-06-12 07:03:22.57478+00	2026-07-07 14:01:02.726+00
54799	records.numberPlaceholder	{"en": "For example: 11.6", "he": "לדוגמה: 11.6", "ru": "Например: 11.6"}	2026-06-12 07:03:22.584737+00	2026-07-07 14:01:03.143+00
54803	common.moveUp	{"en": "Move up", "he": "למעלה", "ru": "Вверх"}	2026-06-13 19:23:03.239458+00	2026-07-07 14:00:57.091+00
47253	fields.dependsOnNone	{"en": "No dependency", "he": "ללא תלות", "ru": "Не зависит"}	2026-06-10 14:14:34.86574+00	2026-07-07 14:00:58.256+00
52908	fields.formulaDecimalsHint	{"en": "Applies only to a numeric result. Empty means no rounding.", "he": "חל רק על תוצאה מספרית. ריק — ללא עיגול.", "ru": "Применяется только к числовому результату. Пусто — без округления."}	2026-06-11 14:28:09.722802+00	2026-07-07 14:00:59.085+00
50683	fields.pinColumn	{"en": "Pin column on horizontal scroll", "he": "הצמד עמודה בגלילה אופקית", "ru": "Закрепить при горизонтальной прокрутке"}	2026-06-10 19:30:37.497311+00	2026-07-07 14:00:59.091+00
47613	records.depParentRequired	{"en": "Select the parent field first", "he": "בחרו תחילה את שדה האב", "ru": "Сначала выберите родительское поле"}	2026-06-10 14:14:36.122225+00	2026-07-07 14:01:00.536+00
47615	records.depSearch	{"en": "Search...", "he": "חיפוש...", "ru": "Поиск..."}	2026-06-10 14:14:36.131883+00	2026-07-07 14:01:00.547+00
49830	records.depSelectPrefix	{"en": "Select", "he": "בחרו", "ru": "Выберите"}	2026-06-10 15:44:53.466715+00	2026-07-07 14:01:00.54+00
47616	records.depEmpty	{"en": "No values", "he": "אין ערכים", "ru": "Нет значений"}	2026-06-10 14:14:36.135196+00	2026-07-07 14:01:00.55+00
47617	records.depAddNew	{"en": "Add value", "he": "הוספת ערך", "ru": "Добавить значение"}	2026-06-10 14:14:36.143164+00	2026-07-07 14:01:00.553+00
47618	records.depDuplicate	{"en": "This value already exists with different casing", "he": "ערך זה כבר קיים בכתיב אחר", "ru": "Такое значение уже существует в другом написании"}	2026-06-10 14:14:36.14932+00	2026-07-07 14:01:00.556+00
49163	views.sortSysCreatedAt	{"en": "Date added (system)", "he": "תאריך הוספה (מערכת)", "ru": "Дата добавления (системная)"}	2026-06-10 14:26:29.331363+00	2026-07-07 14:01:02.502+00
52906	fields.formulaDecimals	{"en": "Decimal places (rounding)", "he": "ספרות אחרי הנקודה (עיגול)", "ru": "Знаков после запятой (округление)"}	2026-06-11 14:28:09.713701+00	2026-07-07 14:00:59.079+00
47614	records.depSelect	{"en": "Select or add", "he": "בחרו או הוסיפו", "ru": "Выберите или добавьте"}	2026-06-10 14:14:36.128237+00	2026-07-07 14:01:00.543+00
47619	records.depRename	{"en": "Rename", "he": "שינוי שם", "ru": "Переименовать"}	2026-06-10 14:14:36.152477+00	2026-07-07 14:01:00.559+00
54800	fields.isKey	{"en": "Key field (unique)", "he": "שדה מפתח (ייחודי)", "ru": "Ключевое поле (уникальное)"}	2026-06-12 07:03:22.587447+00	2026-07-07 14:01:03.076+00
52907	fields.formulaDecimalsNone	{"en": "No rounding", "he": "ללא עיגול", "ru": "Без округления"}	2026-06-11 14:28:09.719895+00	2026-07-07 14:00:59.082+00
47620	records.depRenamed	{"en": "Value renamed", "he": "שם הערך שונה", "ru": "Значение переименовано"}	2026-06-10 14:14:36.15556+00	2026-07-07 14:01:00.563+00
54801	fields.lockAfterCreate	{"en": "Lock after creation", "he": "נעילה לאחר יצירה", "ru": "Запрет изменения после создания"}	2026-06-12 07:03:22.590934+00	2026-07-07 14:01:03.08+00
48115	records.loading	{"en": "Loading...", "he": "טוען...", "ru": "Загрузка..."}	2026-06-10 14:14:37.63906+00	2026-07-07 14:01:03.113+00
47621	records.depRenameError	{"en": "Rename error", "he": "שגיאת שינוי שם", "ru": "Ошибка переименования"}	2026-06-10 14:14:36.158378+00	2026-07-07 14:01:00.566+00
57090	records.mirrorLabelSaved	{"en": "Header updated", "he": "הכותרת עודכנה", "ru": "Заголовок обновлён"}	2026-06-17 16:03:44.490208+00	2026-07-07 14:01:03.13+00
55937	records.relatedCreatedNotLinked	{"en": "Record created but not linked", "he": "הרשומה נוצרה אך לא קושרה", "ru": "Запись создана, но не привязана"}	2026-06-13 19:23:08.570852+00	2026-07-07 14:01:03.164+00
55931	records.relatedPickParentFirst	{"en": "Fill in the parent field first", "he": "מלא תחילה את שדה האב", "ru": "Сначала заполните родительское поле"}	2026-06-13 19:23:08.538083+00	2026-07-07 14:01:03.167+00
108414	records.manageCustomFilters	{"en": "Custom filters", "he": "מסננים מותאמים", "ru": "Кастомные фильтры"}	2026-07-07 09:44:01.853054+00	2026-07-07 14:01:04.574+00
24415	pageFields.relationAccessHint	{"en": "\\"Default\\" means the column inherits the role's access to the related field. Access is constrained by the role's permissions on the related entity.", "he": "«ברירת מחדל» — העמודה יורשת את הרשאות התפקיד לשדה המקושר. הגישה מוגבלת על ידי הרשאות התפקיד לישות המקושרת.", "ru": "«По умолчанию» — столбец наследует права роли на связанное поле. Доступ ограничивается правами роли на связанную сущность."}	2026-06-08 09:45:13.002646+00	2026-07-07 14:01:00.201+00
55930	records.openLinkedRecord	{"en": "Open linked record", "he": "פתח רשומה מקושרת", "ru": "Открыть связанную запись"}	2026-06-13 19:23:08.535793+00	2026-07-07 14:01:03.146+00
55933	records.relatedSelect	{"en": "Select a record", "he": "בחר רשומה", "ru": "Выберите запись"}	2026-06-13 19:23:08.544034+00	2026-07-07 14:01:03.261+00
108415	entities.customFilters	{"en": "Custom filters", "he": "מסננים מותאמים", "ru": "Кастомные фильтры"}	2026-07-07 09:44:01.855332+00	2026-07-07 14:01:04.578+00
10007	fields.formulaHint	{"en": "Reference other fields of this record via {field_key}. Operators: + - * / %, comparisons, && || !, ternary ?:. Functions: if, round, abs, min, max, sum, concat, upper, lower, len, coalesce. Computed on display and not stored.", "he": "הפנו לשדות אחרים של רשומה זו באמצעות {field_key}. אופרטורים: + - * / %, השוואות, && || !, תנאי ?:. פונקציות: if, round, abs, min, max, sum, concat, upper, lower, len, coalesce. מחושב בעת התצוגה ואינו נשמר.", "ru": "Ссылайтесь на другие поля этой записи через {ключ_поля}. Операторы: + - * / %, сравнения, && || !, тернарный ?:. Функции: if, round, abs, min, max, sum, concat, upper, lower, len, coalesce. Вычисляется при показе и не хранится."}	2026-06-07 16:48:22.099369+00	2026-07-07 14:00:58.94+00
55428	records.relatedDuplicateTitle	{"en": "This record already exists", "he": "רשומה כזו כבר קיימת", "ru": "Такая запись уже существует"}	2026-06-13 19:23:06.791695+00	2026-07-07 14:01:00.582+00
55429	records.relatedDuplicateDesc	{"en": "A record with this value already exists. Close this window and pick it from the list instead of creating a new one.", "he": "רשומה עם ערך זה כבר קיימת. סגרו חלון זה ובחרו אותה מהרשימה במקום ליצור חדשה.", "ru": "Запись с таким значением уже есть. Закройте это окно и выберите её из списка, а не создавайте новую."}	2026-06-13 19:23:06.795601+00	2026-07-07 14:01:00.585+00
57089	pageFields.lookupHint	{"en": "A lookup field shows a value from the single linked record (read-only). The source can be a field of the related entity or a page-local field of the linked record.", "he": "שדה חיפוש מציג ערך מהרשומה המקושרת היחידה (לקריאה בלבד). המקור יכול להיות שדה של הישות המקושרת או שדה מקומי של עמוד הרשומה המקושרת.", "ru": "Поле подстановки показывает значение из единственной связанной записи (только для чтения). Источником может быть поле связанной сущности или поле страницы связанной записи."}	2026-06-17 16:03:44.487427+00	2026-07-07 14:01:02.755+00
55935	common.loading	{"en": "Loading...", "he": "טוען...", "ru": "Загрузка..."}	2026-06-13 19:23:08.564918+00	2026-07-07 14:01:03.005+00
55934	records.editLinkedTitle	{"en": "Edit linked record", "he": "ערוך רשומה מקושרת", "ru": "Редактировать связанную запись"}	2026-06-13 19:23:08.553334+00	2026-07-07 14:01:03.109+00
55932	records.relatedCreate	{"en": "Add record", "he": "הוסף רשומה", "ru": "Добавить запись"}	2026-06-13 19:23:08.540992+00	2026-07-07 14:01:03.15+00
55936	records.relatedCreateFailed	{"en": "Failed to create record", "he": "יצירת הרשומה נכשלה", "ru": "Не удалось создать запись"}	2026-06-13 19:23:08.568006+00	2026-07-07 14:01:03.154+00
55939	records.relatedCreateNoFields	{"en": "No fields to fill in", "he": "אין שדות למילוי", "ru": "Нет полей для заполнения"}	2026-06-13 19:23:08.576912+00	2026-07-07 14:01:03.157+00
55938	records.relatedCreateTitle	{"en": "New linked record", "he": "רשומה מקושרת חדשה", "ru": "Новая связанная запись"}	2026-06-13 19:23:08.573855+00	2026-07-07 14:01:03.16+00
108411	cf.yes	{"en": "Yes", "he": "כן", "ru": "Да"}	2026-07-07 09:44:01.843316+00	2026-07-07 14:01:04.565+00
108412	cf.untitled	{"en": "Filter", "he": "מסנן", "ru": "Фильтр"}	2026-07-07 09:44:01.847338+00	2026-07-07 14:01:04.568+00
108413	cf.clear	{"en": "Clear", "he": "נקה", "ru": "Очистить"}	2026-07-07 09:44:01.850028+00	2026-07-07 14:01:04.571+00
58284	pivot.measure	{"en": "Measure (cell value)", "he": "מדד (ערך בתאים)", "ru": "Мера (значение в ячейках)"}	2026-06-18 14:19:33.386507+00	2026-07-07 14:01:02.918+00
57082	fields.lookupSource	{"en": "Value source", "he": "מקור הערך", "ru": "Источник значения"}	2026-06-17 16:03:44.410422+00	2026-07-07 14:01:02.732+00
57083	fields.lookupSourceEntity	{"en": "Related entity fields", "he": "שדות הישות המקושרת", "ru": "Поля связанной сущности"}	2026-06-17 16:03:44.41602+00	2026-07-07 14:01:02.734+00
55951	fields.lockAfterCreateRelationHint	{"en": "For a linked field: once the link is set, it cannot be changed or cleared.", "he": "לשדה מקושר: לאחר שהקישור נקבע, לא ניתן לשנות או לנקות אותו.", "ru": "Для связанного поля: после того как связь установлена, её нельзя будет изменить или очистить."}	2026-06-13 19:23:08.61457+00	2026-07-07 14:01:03.086+00
55945	fields.relatedFilterField	{"en": "Filter field in the related entity", "he": "שדה סינון בישות המקושרת", "ru": "Поле фильтрации в связанной сущности"}	2026-06-13 19:23:08.595456+00	2026-07-07 14:01:03.089+00
55946	fields.relatedFilterFieldPlaceholder	{"en": "Select a field", "he": "בחר שדה", "ru": "Выберите поле"}	2026-06-13 19:23:08.598958+00	2026-07-07 14:01:03.094+00
57074	fields.type.lookup	{"en": "Lookup field", "he": "שדה חיפוש", "ru": "Поле подстановки"}	2026-06-17 16:03:44.385444+00	2026-07-07 14:01:02.706+00
57084	fields.lookupSourcePagePrefix	{"en": "Page", "he": "עמוד", "ru": "Страница"}	2026-06-17 16:03:44.41958+00	2026-07-07 14:01:02.738+00
55948	fields.relatedFilterHint	{"en": "The list of related records is narrowed to those whose this field matches the parent field value in the current row.", "he": "רשימת הרשומות המקושרות מצומצמת לאלה ששדה זה בהן תואם לערך שדה האב בשורה הנוכחית.", "ru": "Список связанных записей будет сужен до тех, у кого это поле совпадает со значением родительского поля в текущей строке."}	2026-06-13 19:23:08.604922+00	2026-07-07 14:01:03.097+00
55947	fields.relatedFilterNone	{"en": "No filter", "he": "ללא סינון", "ru": "Без фильтра"}	2026-06-13 19:23:08.602009+00	2026-07-07 14:01:03.1+00
57085	fields.lookupSourceHint	{"en": "A lookup can take its value from a field of the related entity or from a page-local field of the linked record (read-only).", "he": "חיפוש יכול לקחת את ערכו משדה של הישות המקושרת או משדה מקומי של עמוד הרשומה המקושרת (לקריאה בלבד).", "ru": "Подстановка может брать значение из поля связанной сущности или из поля страницы связанной записи (только для чтения)."}	2026-06-17 16:03:44.42249+00	2026-07-07 14:01:02.741+00
57091	records.mirrorLabelSaveError	{"en": "Failed to save header", "he": "שמירת הכותרת נכשלה", "ru": "Не удалось сохранить заголовок"}	2026-06-17 16:03:44.493876+00	2026-07-07 14:01:03.127+00
55944	fields.lookupHint	{"en": "A lookup field shows a value from the single linked record (read-only). The source can be a field of the related entity or a page-local field of the linked record.", "he": "שדה חיפוש מציג ערך מהרשומה המקושרת היחידה (לקריאה בלבד). המקור יכול להיות שדה של הישות המקושרת או שדה מקומי של עמוד הרשומה המקושרת.", "ru": "Поле подстановки показывает значение из единственной связанной записи (только для чтения). Источником может быть поле связанной сущности или поле страницы связанной записи."}	2026-06-13 19:23:08.592292+00	2026-07-07 14:01:02.728+00
57086	fields.relatedPageField	{"en": "Page field", "he": "שדה עמוד", "ru": "Поле страницы"}	2026-06-17 16:03:44.424915+00	2026-07-07 14:01:02.745+00
57087	fields.lookupWriteThrough	{"en": "Allow editing the source record", "he": "אפשר עריכת רשומת המקור", "ru": "Разрешить редактирование исходной записи"}	2026-06-17 16:03:44.427887+00	2026-07-07 14:01:02.749+00
57088	fields.lookupWriteThroughHint	{"en": "Clicking the cell opens the source record for editing (if the user has permission to modify the source entity).", "he": "לחיצה על התא תפתח את רשומת המקור לעריכה (אם למשתמש יש הרשאה לשנות את ישות המקור).", "ru": "При клике по ячейке откроется окно исходной записи для редактирования (если у пользователя есть права на изменение исходной сущности)."}	2026-06-17 16:03:44.430684+00	2026-07-07 14:01:02.752+00
58270	pivot.cols	{"en": "Columns", "he": "עמודות", "ru": "Столбцы"}	2026-06-18 14:19:33.311808+00	2026-07-07 14:01:02.867+00
58273	pivot.defaultEnable	{"en": "Default pivot table", "he": "טבלת ציר ברירת מחדל", "ru": "Сводная таблица по умолчанию"}	2026-06-18 14:19:33.323154+00	2026-07-07 14:01:02.876+00
58272	pivot.configTitle	{"en": "Pivot table configuration", "he": "תצורת טבלת ציר", "ru": "Конфигурация сводной таблицы"}	2026-06-18 14:19:33.32008+00	2026-07-07 14:01:02.872+00
58274	pivot.defaultHint	{"en": "Adds a Table/Pivot toggle on the records page when no view is selected.", "he": "מוסיף מתג טבלה/ציר בעמוד הרשומות כאשר לא נבחרה תצוגה.", "ru": "Добавляет переключатель «Таблица/Сводная» на странице записей, когда вид не выбран."}	2026-06-18 14:19:33.32678+00	2026-07-07 14:01:02.88+00
58275	pivot.dimStatus	{"en": "Record status", "he": "סטטוס רשומה", "ru": "Статус записи"}	2026-06-18 14:19:33.330947+00	2026-07-07 14:01:02.884+00
58277	pivot.enableCols	{"en": "Add a column dimension", "he": "הוסף מימד עמודות", "ru": "Добавить измерение столбцов"}	2026-06-18 14:19:33.343979+00	2026-07-07 14:01:02.892+00
58278	pivot.entityEnable	{"en": "Enable pivots", "he": "הפעל טבלאות ציר", "ru": "Включить сводные"}	2026-06-18 14:19:33.348217+00	2026-07-07 14:01:02.895+00
58280	pivot.entitySettingsTitle	{"en": "Pivot tables", "he": "טבלאות ציר", "ru": "Сводные таблицы"}	2026-06-18 14:19:33.365982+00	2026-07-07 14:01:02.902+00
58282	pivot.fieldError	{"en": "Field configuration error", "he": "שגיאת הגדרת שדה", "ru": "Ошибка настройки поля"}	2026-06-18 14:19:33.376515+00	2026-07-07 14:01:02.91+00
58283	pivot.loading	{"en": "Building pivot…", "he": "בונה ציר…", "ru": "Строим сводную…"}	2026-06-18 14:19:33.381515+00	2026-07-07 14:01:02.914+00
57119	roles.hideActionsColumn	{"en": "Hide the «Actions» column", "he": "הסתר את עמודת «פעולות»", "ru": "Скрыть колонку «Действия»"}	2026-06-17 16:03:44.582174+00	2026-07-07 14:01:03.264+00
57118	roles.hideStatusColumn	{"en": "Hide the «Status» column", "he": "הסתר את עמודת «סטטוס»", "ru": "Скрыть колонку «Статус»"}	2026-06-17 16:03:44.578498+00	2026-07-07 14:01:03.268+00
57120	roles.ownerViaRelation	{"en": "via relation", "he": "דרך קשר", "ru": "по связи"}	2026-06-17 16:03:44.58468+00	2026-07-07 14:01:03.271+00
58259	dash.typePivot	{"en": "Pivot table", "he": "טבלת ציר", "ru": "Сводная таблица"}	2026-06-18 14:19:33.266959+00	2026-07-07 14:01:02.759+00
58261	dash.pivotSettings	{"en": "Pivot table settings", "he": "הגדרות טבלת ציר", "ru": "Настройки сводной таблицы"}	2026-06-18 14:19:33.27559+00	2026-07-07 14:01:02.766+00
58262	dash.pivotNeedsEntity	{"en": "Select an entity for the pivot table", "he": "בחר ישות לטבלת הציר", "ru": "Выберите сущность для сводной таблицы"}	2026-06-18 14:19:33.279905+00	2026-07-07 14:01:02.769+00
58263	dash.pivotNeedsRows	{"en": "Select a field for the pivot rows", "he": "בחר שדה לשורות הציר", "ru": "Выберите поле для строк сводной таблицы"}	2026-06-18 14:19:33.283379+00	2026-07-07 14:01:02.772+00
58264	dash.pivotNeedsCols	{"en": "Select a field for the pivot columns", "he": "בחר שדה לעמודות הציר", "ru": "Выберите поле для столбцов сводной таблицы"}	2026-06-18 14:19:33.287553+00	2026-07-07 14:01:02.775+00
58265	dash.pivotNeedsMeasure	{"en": "Select a numeric field to sum", "he": "בחר שדה מספרי לסיכום", "ru": "Для суммы выберите числовое поле"}	2026-06-18 14:19:33.290706+00	2026-07-07 14:01:02.779+00
58266	dash.pivotNotEnabled	{"en": "Pivot mode is not enabled for this entity. Enable it in the entity settings.", "he": "מצב ציר אינו מופעל לישות זו. הפעל אותו בהגדרות הישות.", "ru": "Для этой сущности не включён режим сводной таблицы. Включите его в настройках сущности."}	2026-06-18 14:19:33.294344+00	2026-07-07 14:01:02.782+00
58267	pivot.aggCount	{"en": "Record count", "he": "מספר רשומות", "ru": "Количество записей"}	2026-06-18 14:19:33.297722+00	2026-07-07 14:01:02.785+00
58269	pivot.allowedFields	{"en": "Fields available in pivots", "he": "שדות זמינים בטבלאות ציר", "ru": "Поля, доступные в сводных"}	2026-06-18 14:19:33.305747+00	2026-07-07 14:01:02.864+00
28138	dash.notesEditableRolesHint	{"en": "Admins can always edit. Check the roles that are also allowed to change the content directly on the page.", "he": "מנהלים תמיד יכולים לערוך. סמן את התפקידים שמורשים גם הם לשנות את התוכן ישירות בדף.", "ru": "Администраторы могут редактировать всегда. Отметьте роли, которым тоже разрешено менять содержимое прямо на странице."}	2026-06-08 16:43:28.124776+00	2026-07-07 14:00:57.613+00
58260	dash.pivotWidget	{"en": "Pivot table", "he": "טבלת ציר", "ru": "Сводная таблица"}	2026-06-18 14:19:33.271522+00	2026-07-07 14:01:02.762+00
58268	pivot.aggSum	{"en": "Field sum", "he": "סכום שדה", "ru": "Сумма поля"}	2026-06-18 14:19:33.301617+00	2026-07-07 14:01:02.788+00
58271	pivot.colTotal	{"en": "Total", "he": "סך הכול", "ru": "Итого"}	2026-06-18 14:19:33.316067+00	2026-07-07 14:01:02.87+00
58276	pivot.empty	{"en": "No data for the pivot table", "he": "אין נתונים לטבלת הציר", "ru": "Нет данных для сводной таблицы"}	2026-06-18 14:19:33.339995+00	2026-07-07 14:01:02.888+00
58279	pivot.entitySettingsDesc	{"en": "Allow pivot mode for this entity and choose the fields available as dimensions and measures.", "he": "אפשר מצב טבלת ציר לישות זו ובחר את השדות הזמינים כמימדים ומדדים.", "ru": "Разрешите режим сводной таблицы для этой сущности и выберите поля, доступные как измерения и меры."}	2026-06-18 14:19:33.355347+00	2026-07-07 14:01:02.899+00
58281	pivot.error	{"en": "Failed to build the pivot table", "he": "בניית טבלת הציר נכשלה", "ru": "Не удалось построить сводную таблицу"}	2026-06-18 14:19:33.370234+00	2026-07-07 14:01:02.906+00
57097	records.mirrorLabelSource	{"en": "In source", "he": "במקור", "ru": "В источнике"}	2026-06-17 16:03:44.511802+00	2026-07-07 14:01:03.133+00
58289	pivot.needRowField	{"en": "Select the pivot row field", "he": "בחר את שדה שורות הציר", "ru": "Выберите поле строк сводной таблицы"}	2026-06-18 14:19:33.407727+00	2026-07-07 14:01:02.937+00
58291	pivot.noNumberFields	{"en": "No numeric fields in pivots", "he": "אין שדות מספריים בטבלאות ציר", "ru": "Нет числовых полей в сводных"}	2026-06-18 14:19:33.416204+00	2026-07-07 14:01:02.944+00
58292	pivot.noRoles	{"en": "No roles configured.", "he": "לא הוגדרו תפקידים.", "ru": "Роли не настроены."}	2026-06-18 14:19:33.420718+00	2026-07-07 14:01:02.948+00
58293	pivot.periodDay	{"en": "Day", "he": "יום", "ru": "День"}	2026-06-18 14:19:33.425451+00	2026-07-07 14:01:02.951+00
58297	pivot.roleVisibility	{"en": "Role visibility", "he": "נראות לפי תפקיד", "ru": "Видимость по ролям"}	2026-06-18 14:19:33.442318+00	2026-07-07 14:01:02.964+00
58299	pivot.rows	{"en": "Rows", "he": "שורות", "ru": "Строки"}	2026-06-18 14:19:33.45087+00	2026-07-07 14:01:02.977+00
58300	pivot.rowTotal	{"en": "Total", "he": "סך הכול", "ru": "Итого"}	2026-06-18 14:19:33.454665+00	2026-07-07 14:01:02.98+00
58301	pivot.selectDim	{"en": "field…", "he": "שדה…", "ru": "поле…"}	2026-06-18 14:19:33.461024+00	2026-07-07 14:01:02.984+00
58314	dash.addTerm	{"en": "Field", "he": "שדה", "ru": "Поле"}	2026-06-18 14:19:33.529592+00	2026-07-07 14:01:03.008+00
58323	dash.chartCountField	{"en": "Field (non-empty values)", "he": "שדה (ערכים לא ריקים)", "ru": "Поле (непустые значения)"}	2026-06-18 14:19:33.568465+00	2026-07-07 14:01:03.011+00
58309	dash.chartNeedsField	{"en": "Select a page field for the chart", "he": "בחר שדה עמוד לתרשים", "ru": "Выберите поле страницы для графика"}	2026-06-18 14:19:33.498115+00	2026-07-07 14:01:03.016+00
58308	dash.chartNeedsPage	{"en": "Select a page for the chart", "he": "בחר עמוד לתרשים", "ru": "Выберите страницу для графика"}	2026-06-18 14:19:33.494826+00	2026-07-07 14:01:03.02+00
58315	dash.formulaRequired	{"en": "Formula", "he": "נוסחה", "ru": "Формула"}	2026-06-18 14:19:33.532762+00	2026-07-07 14:01:03.036+00
58313	dash.formulaTerms	{"en": "Formula fields", "he": "שדות הנוסחה", "ru": "Поля формулы"}	2026-06-18 14:19:33.522877+00	2026-07-07 14:01:03.039+00
58318	dash.formulaWidgetFormulaHint	{"en": "Combine fields by key: {m1}. Without a formula the first field is shown.", "he": "שלב שדות לפי מפתח: {m1}. ללא נוסחה מוצג השדה הראשון.", "ru": "Комбинируйте поля по ключу: {m1}. Без формулы показывается первое поле."}	2026-06-18 14:19:33.547508+00	2026-07-07 14:01:03.043+00
58312	dash.formulaWidgetHint	{"en": "Add fields from different entities and page fields as terms, then combine them in a formula.", "he": "הוסף שדות מישויות שונות ומשדות עמוד כאיברים, ואז שלב אותם בנוסחה.", "ru": "Добавьте поля из разных сущностей и полей страниц как слагаемые, затем объедините их в формуле."}	2026-06-18 14:19:33.519417+00	2026-07-07 14:01:03.046+00
58310	dash.metricNeedsPage	{"en": "Select a page for each metric", "he": "בחר עמוד לכל מדד", "ru": "Выберите страницу для каждой метрики"}	2026-06-18 14:19:33.502978+00	2026-07-07 14:01:03.049+00
58311	dash.metricNeedsPageField	{"en": "Select a page field for the metric", "he": "בחר שדה עמוד למדד", "ru": "Выберите поле страницы для метрики"}	2026-06-18 14:19:33.51135+00	2026-07-07 14:01:03.055+00
58322	dash.selectPage	{"en": "Page", "he": "עמוד", "ru": "Страница"}	2026-06-18 14:19:33.564768+00	2026-07-07 14:01:03.058+00
58320	dash.sourceEntity	{"en": "Entity", "he": "ישות", "ru": "Сущность"}	2026-06-18 14:19:33.556097+00	2026-07-07 14:01:03.063+00
58302	pivot.selectNumberField	{"en": "numeric field…", "he": "שדה מספרי…", "ru": "числовое поле…"}	2026-06-18 14:19:33.469499+00	2026-07-07 14:01:02.987+00
58303	pivot.settingsError	{"en": "Pivot settings error", "he": "שגיאת הגדרות ציר", "ru": "Ошибка настройки сводных"}	2026-06-18 14:19:33.474027+00	2026-07-07 14:01:02.991+00
58307	dash.fieldsCount	{"en": "Fields", "he": "שדות", "ru": "Полей"}	2026-06-18 14:19:33.491316+00	2026-07-07 14:01:03.023+00
58317	dash.formulaInsertMetric	{"en": "Insert metric:", "he": "הוסף מדד:", "ru": "Вставить метрику:"}	2026-06-18 14:19:33.542241+00	2026-07-07 14:01:03.026+00
58321	dash.sourcePage	{"en": "Page field", "he": "שדה עמוד", "ru": "Поле страницы"}	2026-06-18 14:19:33.560526+00	2026-07-07 14:01:03.065+00
58306	dash.typeFormula	{"en": "Formula", "he": "נוסחה", "ru": "Формула"}	2026-06-18 14:19:33.488062+00	2026-07-07 14:01:03.069+00
58319	dash.valueSource	{"en": "Data source", "he": "מקור נתונים", "ru": "Источник данных"}	2026-06-18 14:19:33.551914+00	2026-07-07 14:01:03.072+00
58294	pivot.periodMonth	{"en": "Month", "he": "חודש", "ru": "Месяц"}	2026-06-18 14:19:33.428991+00	2026-07-07 14:01:02.954+00
58295	pivot.periodQuarter	{"en": "Quarter", "he": "רבעון", "ru": "Квартал"}	2026-06-18 14:19:33.433588+00	2026-07-07 14:01:02.957+00
58296	pivot.periodYear	{"en": "Year", "he": "שנה", "ru": "Год"}	2026-06-18 14:19:33.436744+00	2026-07-07 14:01:02.96+00
58304	pivot.updating	{"en": "Updating…", "he": "מעדכן…", "ru": "Обновление…"}	2026-06-18 14:19:33.478592+00	2026-07-07 14:01:02.994+00
58316	dash.formulaInsertTerm	{"en": "Insert field:", "he": "הוסף שדה:", "ru": "Вставить поле:"}	2026-06-18 14:19:33.537987+00	2026-07-07 14:01:03.029+00
58305	pivot.viewMode	{"en": "Display type", "he": "סוג תצוגה", "ru": "Тип отображения"}	2026-06-18 14:19:33.48382+00	2026-07-07 14:01:02.998+00
67405	auto.specifyTarget	{"en": "Specify the target entity", "he": "ציין את ישות היעד", "ru": "Укажите целевую сущность"}	2026-06-19 07:26:25.275774+00	2026-07-07 14:01:03.684+00
62023	pivot.formulaNamePlaceholder	{"en": "Formula", "he": "נוסחה", "ru": "Формула"}	2026-06-18 19:38:55.732815+00	2026-07-07 14:01:02.86+00
58298	pivot.roleVisibilityHint	{"en": "If no roles are selected, the view is visible to everyone with record access. Otherwise only to the selected roles (super admin always sees it).", "he": "אם לא נבחרו תפקידים, התצוגה גלויה לכל מי שיש לו גישה לרשומות. אחרת רק לתפקידים שנבחרו (מנהל-על תמיד רואה).", "ru": "Если роли не выбраны, вид виден всем, у кого есть доступ к записям. Иначе — только выбранным ролям (суперадмин видит всегда)."}	2026-06-18 14:19:33.445816+00	2026-07-07 14:01:02.967+00
58324	dash.formulaInsertValue	{"en": "Insert value:", "he": "הוסף ערך:", "ru": "Вставить значение:"}	2026-06-18 14:19:33.573399+00	2026-07-07 14:01:03.033+00
57117	pages.mirrorLabelInlineHint	{"en": "You can rename field headers right on the page: «Setup mode» → click a header.", "he": "ניתן לשנות שמות כותרות שדות ישירות בעמוד: «מצב הגדרה» ← לחיצה על כותרת.", "ru": "Переименовать заголовки полей можно прямо на странице: «Режим настройки» → клик по заголовку."}	2026-06-17 16:03:44.574641+00	2026-07-07 14:01:03.104+00
57095	records.mirrorLabelDesc	{"en": "The rename applies only to this mirror page. The source entity field is not changed.", "he": "שינוי השם חל רק על עמוד שיקוף זה. שדה הישות המקורי אינו משתנה.", "ru": "Переименование действует только на этой зеркальной странице. Исходное поле сущности не меняется."}	2026-06-17 16:03:44.505588+00	2026-07-07 14:01:03.117+00
57096	records.mirrorLabelInput	{"en": "New header (empty = same as source)", "he": "כותרת חדשה (ריק = כמו במקור)", "ru": "Новый заголовок (пусто = как в источнике)"}	2026-06-17 16:03:44.508103+00	2026-07-07 14:01:03.124+00
58355	views.boolFalse	{"en": "No", "he": "לא", "ru": "Нет"}	2026-06-18 14:19:33.720073+00	2026-07-07 14:01:03.275+00
58356	views.defaultViewCardTitle	{"en": "Default filters and sorting", "he": "סינון ומיון ברירת מחדל", "ru": "Фильтры и сортировка по умолчанию"}	2026-06-18 14:19:33.723879+00	2026-07-07 14:01:03.288+00
58360	views.defaultViewDialogDesc	{"en": "These filters and sorting apply to records when no view is selected. A selected view uses its own settings.", "he": "סינון ומיון אלה חלים על הרשומות כאשר לא נבחרה תצוגה. תצוגה שנבחרה משתמשת בהגדרות שלה.", "ru": "Эти фильтры и сортировка применяются к записям, когда вид не выбран. Выбранный вид использует свои собственные настройки."}	2026-06-18 14:19:33.740563+00	2026-07-07 14:01:03.291+00
58359	views.defaultViewTitle	{"en": "Default settings", "he": "הגדרות ברירת מחדל", "ru": "Настройки по умолчанию"}	2026-06-18 14:19:33.736881+00	2026-07-07 14:01:03.294+00
58353	views.noUsers	{"en": "No users", "he": "אין משתמשים", "ru": "Нет пользователей"}	2026-06-18 14:19:33.706739+00	2026-07-07 14:01:03.301+00
67401	auto.reorderError	{"en": "Reorder error", "he": "שגיאת שינוי סדר", "ru": "Ошибка изменения порядка"}	2026-06-19 07:26:25.259942+00	2026-07-07 14:01:03.671+00
67402	auto.specifyField	{"en": "Specify the trigger field", "he": "ציין את שדה הטריגר", "ru": "Укажите поле триггера"}	2026-06-19 07:26:25.264249+00	2026-07-07 14:01:03.674+00
58288	pivot.needMeasureField	{"en": "Select a numeric field to sum", "he": "בחר שדה מספרי לסיכום", "ru": "Выберите числовое поле для суммы"}	2026-06-18 14:19:33.403727+00	2026-07-07 14:01:02.933+00
58354	views.boolTrue	{"en": "Yes", "he": "כן", "ru": "Да"}	2026-06-18 14:19:33.714486+00	2026-07-07 14:01:03.277+00
58358	views.defaultFiltersNone	{"en": "No filters", "he": "ללא סינונים", "ru": "Без фильтров"}	2026-06-18 14:19:33.731702+00	2026-07-07 14:01:03.281+00
58290	pivot.noEligibleFields	{"en": "No eligible fields (text, number, date, select, boolean).", "he": "אין שדות מתאימים (טקסט, מספר, תאריך, רשימה, בוליאני).", "ru": "Нет подходящих полей (текст, число, дата, список, логическое)."}	2026-06-18 14:19:33.411751+00	2026-07-07 14:01:02.94+00
58352	views.selectUser	{"en": "select a user", "he": "בחר משתמש", "ru": "выберите пользователя"}	2026-06-18 14:19:33.703824+00	2026-07-07 14:01:03.304+00
67399	auto.deleted	{"en": "Automation deleted", "he": "האוטומציה נמחקה", "ru": "Автоматизация удалена"}	2026-06-19 07:26:25.251417+00	2026-07-07 14:01:03.666+00
67403	auto.specifyActionField	{"en": "Specify the action field", "he": "ציין את שדה הפעולה", "ru": "Укажите поле действия"}	2026-06-19 07:26:25.268396+00	2026-07-07 14:01:03.678+00
67404	auto.specifyStatus	{"en": "Specify the status", "he": "ציין את הסטטוס", "ru": "Укажите статус"}	2026-06-19 07:26:25.272162+00	2026-07-07 14:01:03.68+00
58357	views.defaultViewCardDesc	{"en": "Applied when no view is selected. Without configuration — all records by creation date (newest first).", "he": "חלים כאשר לא נבחרה תצוגה. ללא הגדרה — כל הרשומות לפי תאריך יצירה (החדשות תחילה).", "ru": "Применяются, когда вид не выбран. Без настройки — все записи по дате создания (сначала новые)."}	2026-06-18 14:19:33.727481+00	2026-07-07 14:01:03.284+00
67400	auto.deleteError	{"en": "Deletion error", "he": "שגיאת מחיקה", "ru": "Ошибка удаления"}	2026-06-19 07:26:25.255536+00	2026-07-07 14:01:03.668+00
62013	pivot.multiMeasureHint	{"en": "Multiple measures: each measure is its own column. The column dimension is unavailable and row totals are not computed.", "he": "מספר מדדים: כל מדד הוא עמודה נפרדת. ממד העמודות אינו זמין וסיכומי שורות אינם מחושבים.", "ru": "Несколько мер: каждая мера — отдельный столбец. Измерение столбцов недоступно, итоги по строкам не считаются."}	2026-06-18 19:38:55.701956+00	2026-07-07 14:01:02.827+00
62007	pivot.measures	{"en": "Measures (value columns)", "he": "מדדים (עמודות ערכים)", "ru": "Меры (столбцы значений)"}	2026-06-18 19:38:55.685324+00	2026-07-07 14:01:02.8+00
62010	pivot.measureNamePlaceholder	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-18 19:38:55.694014+00	2026-07-07 14:01:02.811+00
62014	pivot.needMeasure	{"en": "Add at least one measure", "he": "הוסיפו לפחות מדד אחד", "ru": "Добавьте хотя бы одну меру"}	2026-06-18 19:38:55.704983+00	2026-07-07 14:01:02.832+00
62017	pivot.dupMeasureKey	{"en": "Duplicate measure key", "he": "מפתח מדד כפול", "ru": "Дублирующийся ключ меры"}	2026-06-18 19:38:55.715359+00	2026-07-07 14:01:02.842+00
62020	pivot.formulaMeasureHint	{"en": "Evaluated per record, then summed into each cell. Reference fields via {field_key} (only pivot-enabled fields are available).", "he": "מחושב לכל רשומה ואז מסוכם לכל תא. הפנו לשדות באמצעות {field_key} (זמינים רק שדות שהופעלו בטבלת ציר).", "ru": "Вычисляется для каждой записи, затем суммируется по ячейкам. Ссылайтесь на поля через {ключ_поля} (доступны поля, включённые в сводные)."}	2026-06-18 19:38:55.723758+00	2026-07-07 14:01:02.851+00
62021	pivot.needFormula	{"en": "Enter a formula for the measure", "he": "הזינו נוסחה עבור המדד", "ru": "Введите формулу для меры"}	2026-06-18 19:38:55.726823+00	2026-07-07 14:01:02.854+00
67406	auto.specifyUrl	{"en": "Specify the URL", "he": "ציין כתובת URL", "ru": "Укажите URL"}	2026-06-19 07:26:25.278669+00	2026-07-07 14:01:03.687+00
62714	pages.typePivot	{"en": "Pivot table", "he": "טבלת ציר", "ru": "Сводная таблица"}	2026-06-19 04:59:02.261324+00	2026-07-07 14:01:00.388+00
62717	pages.pivotEntityRequired	{"en": "Select an entity for the pivot table", "he": "בחר ישות לטבלת הציר", "ru": "Выберите сущность для сводной таблицы"}	2026-06-19 04:59:02.2745+00	2026-07-07 14:01:00.4+00
62008	pivot.addMeasure	{"en": "Measure", "he": "מדד", "ru": "Мера"}	2026-06-18 19:38:55.688353+00	2026-07-07 14:01:02.804+00
62009	pivot.measureName	{"en": "Measure name (column header)", "he": "שם המדד (כותרת עמודה)", "ru": "Название меры (заголовок столбца)"}	2026-06-18 19:38:55.691066+00	2026-07-07 14:01:02.807+00
62011	pivot.calcFormulaLabel	{"en": "Formula over measures", "he": "נוסחה לפי מדדים", "ru": "Формула по мерам"}	2026-06-18 19:38:55.696454+00	2026-07-07 14:01:02.818+00
62012	pivot.calcFormulaHint	{"en": "Computed per row from the already-aggregated values of the OTHER measures. Reference a measure via {measure_key}.", "he": "מחושב לכל שורה מתוך הערכים המצרפיים של המדדים האחרים. הפנו למדד באמצעות {measure_key}.", "ru": "Вычисляется для каждой строки по уже посчитанным значениям ДРУГИХ мер. Ссылайтесь на меру через {ключ_меры}."}	2026-06-18 19:38:55.699473+00	2026-07-07 14:01:02.823+00
62015	pivot.needCalcFormula	{"en": "Enter the calc measure formula", "he": "הזינו את נוסחת מדד החישוב", "ru": "Введите формулу вычисляемой меры"}	2026-06-18 19:38:55.70818+00	2026-07-07 14:01:02.835+00
62016	pivot.calcNeedsOthers	{"en": "A calc measure requires other measures", "he": "מדד חישוב דורש מדדים אחרים", "ru": "Вычисляемая мера требует других мер"}	2026-06-18 19:38:55.711557+00	2026-07-07 14:01:02.839+00
62018	pivot.needValueMeasure	{"en": "Add at least one non-calc measure", "he": "הוסיפו לפחות מדד אחד שאינו חישוב", "ru": "Добавьте хотя бы одну невычисляемую меру"}	2026-06-18 19:38:55.717932+00	2026-07-07 14:01:02.845+00
62022	pivot.formulaNameLabel	{"en": "Measure name (column header)", "he": "שם המדד (כותרת עמודה)", "ru": "Название меры (заголовок столбца)"}	2026-06-18 19:38:55.72938+00	2026-07-07 14:01:02.858+00
60788	pivot.defaultRoleVisibility	{"en": "Pivot role visibility", "he": "נראות הטבלה המסכמת לפי תפקיד", "ru": "Видимость сводной по ролям"}	2026-06-18 16:57:02.328038+00	2026-07-07 14:01:02.97+00
67407	auto.noActions	{"en": "Add at least one action", "he": "הוסף לפחות פעולה אחת", "ru": "Добавьте хотя бы одно действие"}	2026-06-19 07:26:25.285818+00	2026-07-07 14:01:03.69+00
67408	auto.backToEntities	{"en": "Back to entities", "he": "חזרה לישויות", "ru": "К списку сущностей"}	2026-06-19 07:26:25.290117+00	2026-07-07 14:01:03.694+00
62715	pages.pivotEntity	{"en": "Entity for the pivot table", "he": "ישות לטבלת הציר", "ru": "Сущность для сводной таблицы"}	2026-06-19 04:59:02.268016+00	2026-07-07 14:01:00.394+00
62716	pages.pivotEntitySelect	{"en": "— Select an entity —", "he": "— בחר ישות —", "ru": "— Выберите сущность —"}	2026-06-19 04:59:02.271438+00	2026-07-07 14:01:00.397+00
62019	pivot.formulaMeasureLabel	{"en": "Measure formula", "he": "נוסחת מדד", "ru": "Формула меры"}	2026-06-18 19:38:55.721211+00	2026-07-07 14:01:02.848+00
62005	pivot.aggFormula	{"en": "Formula", "he": "נוסחה", "ru": "Формула"}	2026-06-18 19:38:55.676284+00	2026-07-07 14:01:02.793+00
62006	pivot.aggCalc	{"en": "Calc over measures", "he": "חישוב לפי מדדים", "ru": "Вычисление по мерам"}	2026-06-18 19:38:55.682151+00	2026-07-07 14:01:02.796+00
67409	auto.trig.record_created	{"en": "Record created", "he": "רשומה נוצרה", "ru": "Создание записи"}	2026-06-19 07:26:25.296119+00	2026-07-07 14:01:03.698+00
62722	pages.pivotView	{"en": "View", "he": "תצוגה", "ru": "Представление"}	2026-06-19 04:59:02.291063+00	2026-07-07 14:01:00.416+00
62723	pages.pivotViewSelect	{"en": "— Select a view —", "he": "— בחר תצוגה —", "ru": "— Выберите представление —"}	2026-06-19 04:59:02.294011+00	2026-07-07 14:01:00.419+00
62724	pages.pivotNoViews	{"en": "This entity has no views with a pivot table", "he": "לישות זו אין תצוגות עם טבלת ציר", "ru": "У этой сущности нет представлений со сводной таблицей"}	2026-06-19 04:59:02.297783+00	2026-07-07 14:01:00.422+00
64686	calendar.configTitle	{"en": "Calendar configuration", "he": "תצורת לוח שנה", "ru": "Конфигурация календаря"}	2026-06-19 06:29:46.720668+00	2026-07-07 14:01:03.311+00
64687	calendar.dateField	{"en": "Date field", "he": "שדה תאריך", "ru": "Поле даты"}	2026-06-19 06:29:46.724086+00	2026-07-07 14:01:03.314+00
64694	calendar.cardFields	{"en": "Chip details", "he": "פרטי תווית", "ru": "Данные на плашке"}	2026-06-19 06:29:46.751067+00	2026-07-07 14:01:03.337+00
64695	calendar.cardFieldsNone	{"en": "title only", "he": "כותרת בלבד", "ru": "только заголовок"}	2026-06-19 06:29:46.754136+00	2026-07-07 14:01:03.34+00
67410	auto.trig.record_updated	{"en": "Record updated", "he": "רשומה עודכנה", "ru": "Изменение записи"}	2026-06-19 07:26:25.299708+00	2026-07-07 14:01:03.7+00
67411	auto.trig.field_changed	{"en": "Field changed", "he": "שדה השתנה", "ru": "Изменение поля"}	2026-06-19 07:26:25.303692+00	2026-07-07 14:01:03.704+00
67412	auto.trig.status_changed	{"en": "Status changed", "he": "סטטוס השתנה", "ru": "Смена статуса"}	2026-06-19 07:26:25.308975+00	2026-07-07 14:01:03.71+00
67413	auto.trig.date_reached	{"en": "Date reached", "he": "הגיע תאריך", "ru": "Наступление даты"}	2026-06-19 07:26:25.312439+00	2026-07-07 14:01:03.713+00
62725	pages.pivotStatuses	{"en": "Statuses only (empty = all)", "he": "סטטוסים בלבד (ריק = הכול)", "ru": "Только статусы (пусто = все)"}	2026-06-19 04:59:02.30011+00	2026-07-07 14:01:00.425+00
64688	calendar.selectDateField	{"en": "select a date field…", "he": "בחר שדה תאריך…", "ru": "выберите поле даты…"}	2026-06-19 06:29:46.727214+00	2026-07-07 14:01:03.318+00
64689	calendar.noDateFields	{"en": "The entity has no date fields. Add a date field to use the calendar.", "he": "לישות אין שדות תאריך. הוסף שדה תאריך כדי להשתמש בלוח השנה.", "ru": "У сущности нет полей типа «дата». Добавьте поле даты, чтобы использовать календарь."}	2026-06-19 06:29:46.729932+00	2026-07-07 14:01:03.32+00
62718	pages.pivotSource	{"en": "Pivot configuration source", "he": "מקור הגדרות הציר", "ru": "Источник настроек сводной"}	2026-06-19 04:59:02.277539+00	2026-07-07 14:01:00.403+00
62726	pages.pivotSearch	{"en": "Search", "he": "חיפוש", "ru": "Поиск"}	2026-06-19 04:59:02.303227+00	2026-07-07 14:01:00.43+00
62727	pages.pivotSearchPlaceholder	{"en": "Filter by text…", "he": "סינון לפי טקסט…", "ru": "Фильтр по тексту…"}	2026-06-19 04:59:02.305601+00	2026-07-07 14:01:00.433+00
62728	pages.pivotAuthHint	{"en": "Totals are computed over all of the entity's records — the same for everyone with page access.", "he": "הסכומים מחושבים על כל רשומות הישות — זהה לכל מי שיש לו גישה לעמוד.", "ru": "Итоги считаются по всем записям сущности — одинаково для всех, у кого есть доступ к странице."}	2026-06-19 04:59:02.309443+00	2026-07-07 14:01:00.437+00
64690	calendar.endDateField	{"en": "End date field", "he": "שדה תאריך סיום", "ru": "Поле даты окончания"}	2026-06-19 06:29:46.733028+00	2026-07-07 14:01:03.325+00
62719	pages.pivotSourceEntity	{"en": "Entity default", "he": "ברירת מחדל של הישות", "ru": "По умолчанию из сущности"}	2026-06-19 04:59:02.280138+00	2026-07-07 14:01:00.406+00
64685	calendar.modeCalendar	{"en": "Calendar", "he": "לוח שנה", "ru": "Календарь"}	2026-06-19 06:29:46.715512+00	2026-07-07 14:01:03.307+00
64691	calendar.endDateNone	{"en": "No range (single day)", "he": "ללא טווח (יום בודד)", "ru": "Без диапазона (один день)"}	2026-06-19 06:29:46.735642+00	2026-07-07 14:01:03.328+00
64692	calendar.titleField	{"en": "Title field", "he": "שדה כותרת", "ru": "Поле заголовка"}	2026-06-19 06:29:46.738915+00	2026-07-07 14:01:03.331+00
64693	calendar.titleAuto	{"en": "Automatic (first text field)", "he": "אוטומטי (שדה הטקסט הראשון)", "ru": "Автоматически (первое текстовое поле)"}	2026-06-19 06:29:46.743328+00	2026-07-07 14:01:03.334+00
62720	pages.pivotSourceView	{"en": "From a view", "he": "מתצוגה", "ru": "Из представления"}	2026-06-19 04:59:02.283661+00	2026-07-07 14:01:00.41+00
62721	pages.pivotSourceCustom	{"en": "Custom configuration", "he": "הגדרות מותאמות אישית", "ru": "Свои настройки"}	2026-06-19 04:59:02.288033+00	2026-07-07 14:01:00.413+00
64707	calendar.needDateField	{"en": "Select a date field for the calendar", "he": "בחר שדה תאריך עבור לוח השנה", "ru": "Выберите поле даты для календаря"}	2026-06-19 06:29:46.801157+00	2026-07-07 14:01:03.378+00
64708	calendar.noDateConfigured	{"en": "No calendar date field configured", "he": "לא הוגדר שדה תאריך ללוח השנה", "ru": "Поле даты для календаря не настроено"}	2026-06-19 06:29:46.804404+00	2026-07-07 14:01:03.381+00
64709	calendar.today	{"en": "Today", "he": "היום", "ru": "Сегодня"}	2026-06-19 06:29:46.807505+00	2026-07-07 14:01:03.384+00
64710	calendar.more	{"en": "more", "he": "עוד", "ru": "ещё"}	2026-06-19 06:29:46.810923+00	2026-07-07 14:01:03.387+00
64711	calendar.noEvents	{"en": "No events", "he": "אין אירועים", "ru": "Нет событий"}	2026-06-19 06:29:46.814575+00	2026-07-07 14:01:03.393+00
64712	calendar.empty	{"en": "No events in this range", "he": "אין אירועים בטווח זה", "ru": "Нет событий в этом диапазоне"}	2026-06-19 06:29:46.818262+00	2026-07-07 14:01:03.402+00
64713	calendar.untitled	{"en": "Untitled", "he": "ללא כותרת", "ru": "Без названия"}	2026-06-19 06:29:46.821779+00	2026-07-07 14:01:03.407+00
64714	calendar.error	{"en": "Failed to load the calendar", "he": "טעינת לוח השנה נכשלה", "ru": "Не удалось загрузить календарь"}	2026-06-19 06:29:46.82512+00	2026-07-07 14:01:03.41+00
64696	calendar.cardFieldsHint	{"en": "Extra record fields shown on the event chip under the title.", "he": "שדות רשומה נוספים המוצגים על תווית האירוע מתחת לכותרת.", "ru": "Дополнительные поля записи, показываемые на плашке события под заголовком."}	2026-06-19 06:29:46.758452+00	2026-07-07 14:01:03.343+00
64697	calendar.colorBy	{"en": "Chip color", "he": "צבע תווית", "ru": "Цвет плашки"}	2026-06-19 06:29:46.762997+00	2026-07-07 14:01:03.346+00
64698	calendar.colorNone	{"en": "No color", "he": "ללא צבע", "ru": "Без цвета"}	2026-06-19 06:29:46.766624+00	2026-07-07 14:01:03.349+00
64699	calendar.colorStatus	{"en": "By status", "he": "לפי סטטוס", "ru": "По статусу"}	2026-06-19 06:29:46.769308+00	2026-07-07 14:01:03.352+00
64700	calendar.colorField	{"en": "By field", "he": "לפי שדה", "ru": "По полю"}	2026-06-19 06:29:46.773324+00	2026-07-07 14:01:03.355+00
64701	calendar.selectField	{"en": "field…", "he": "שדה…", "ru": "поле…"}	2026-06-19 06:29:46.775661+00	2026-07-07 14:01:03.359+00
66026	calendar.truncated	{"en": "Not all events are shown: too many records. Narrow the range or filters.", "he": "לא כל האירועים מוצגים: יותר מדי רשומות. צמצם את הטווח או המסננים.", "ru": "Показаны не все события: слишком много записей. Сузьте период или фильтры."}	2026-06-19 06:37:45.988765+00	2026-07-07 14:01:03.414+00
67339	entities.automations	{"en": "Automations", "he": "אוטומציות", "ru": "Автоматизации"}	2026-06-19 07:26:24.984353+00	2026-07-07 14:01:03.417+00
67340	auto.title	{"en": "Automations", "he": "אוטומציות", "ru": "Автоматизации"}	2026-06-19 07:26:25.052117+00	2026-07-07 14:01:03.421+00
67414	auto.act.set_field	{"en": "Set field", "he": "הגדר שדה", "ru": "Установить поле"}	2026-06-19 07:26:25.315701+00	2026-07-07 14:01:03.734+00
67415	auto.act.change_status	{"en": "Change status", "he": "שנה סטטוס", "ru": "Сменить статус"}	2026-06-19 07:26:25.320261+00	2026-07-07 14:01:03.738+00
67416	auto.act.create_record	{"en": "Create record", "he": "צור רשומה", "ru": "Создать запись"}	2026-06-19 07:26:25.323436+00	2026-07-07 14:01:03.745+00
64702	calendar.defaultMode	{"en": "Default mode", "he": "מצב ברירת מחדל", "ru": "Режим по умолчанию"}	2026-06-19 06:29:46.780555+00	2026-07-07 14:01:03.362+00
64703	calendar.modeMonth	{"en": "Month", "he": "חודש", "ru": "Месяц"}	2026-06-19 06:29:46.783943+00	2026-07-07 14:01:03.365+00
64704	calendar.modeWeek	{"en": "Week", "he": "שבוע", "ru": "Неделя"}	2026-06-19 06:29:46.788339+00	2026-07-07 14:01:03.368+00
64705	calendar.modeDay	{"en": "Day", "he": "יום", "ru": "День"}	2026-06-19 06:29:46.79331+00	2026-07-07 14:01:03.371+00
64706	calendar.modeAgenda	{"en": "Agenda", "he": "סדר יום", "ru": "Повестка"}	2026-06-19 06:29:46.798205+00	2026-07-07 14:01:03.375+00
67371	auto.fieldMapping	{"en": "Field values", "he": "ערכי שדות", "ru": "Значения полей"}	2026-06-19 07:26:25.1512+00	2026-07-07 14:01:03.541+00
67372	auto.targetField	{"en": "Field", "he": "שדה", "ru": "Поле"}	2026-06-19 07:26:25.154169+00	2026-07-07 14:01:03.544+00
67373	auto.literal	{"en": "Value", "he": "ערך", "ru": "Значение"}	2026-06-19 07:26:25.157812+00	2026-07-07 14:01:03.548+00
67374	auto.fromField	{"en": "From field", "he": "משדה", "ru": "Из поля"}	2026-06-19 07:26:25.161503+00	2026-07-07 14:01:03.551+00
67375	auto.sourceField	{"en": "Source field", "he": "שדה מקור", "ru": "Поле-источник"}	2026-06-19 07:26:25.164702+00	2026-07-07 14:01:03.574+00
67376	auto.addMapping	{"en": "Add field", "he": "הוסף שדה", "ru": "Добавить поле"}	2026-06-19 07:26:25.167267+00	2026-07-07 14:01:03.577+00
67377	auto.includeRecord	{"en": "Send record data", "he": "שלח נתוני רשומה", "ru": "Передавать данные записи"}	2026-06-19 07:26:25.171206+00	2026-07-07 14:01:03.581+00
67378	auto.valuePlaceholder	{"en": "value", "he": "ערך", "ru": "значение"}	2026-06-19 07:26:25.175306+00	2026-07-07 14:01:03.583+00
67379	auto.selectUser	{"en": "User", "he": "משתמש", "ru": "Пользователь"}	2026-06-19 07:26:25.180089+00	2026-07-07 14:01:03.587+00
67380	auto.yes	{"en": "Yes", "he": "כן", "ru": "Да"}	2026-06-19 07:26:25.182516+00	2026-07-07 14:01:03.589+00
67381	auto.no	{"en": "No", "he": "לא", "ru": "Нет"}	2026-06-19 07:26:25.186753+00	2026-07-07 14:01:03.594+00
67382	auto.historyTitle	{"en": "Run history", "he": "היסטוריית הרצות", "ru": "История запусков"}	2026-06-19 07:26:25.190164+00	2026-07-07 14:01:03.609+00
67383	auto.historyDesc	{"en": "Recent automation runs for this entity.", "he": "הרצות אוטומציה אחרונות עבור ישות זו.", "ru": "Последние запуски автоматизаций этой сущности."}	2026-06-19 07:26:25.194745+00	2026-07-07 14:01:03.612+00
67384	auto.noRuns	{"en": "No runs yet.", "he": "אין עדיין הרצות.", "ru": "Запусков пока нет."}	2026-06-19 07:26:25.198017+00	2026-07-07 14:01:03.615+00
67385	auto.runTime	{"en": "Time", "he": "זמן", "ru": "Время"}	2026-06-19 07:26:25.202557+00	2026-07-07 14:01:03.619+00
67386	auto.runAuto	{"en": "Automation", "he": "אוטומציה", "ru": "Автоматизация"}	2026-06-19 07:26:25.205699+00	2026-07-07 14:01:03.623+00
67387	auto.runTrigger	{"en": "Trigger", "he": "טריגר", "ru": "Триггер"}	2026-06-19 07:26:25.209912+00	2026-07-07 14:01:03.626+00
67388	auto.runRecord	{"en": "Record", "he": "רשומה", "ru": "Запись"}	2026-06-19 07:26:25.213162+00	2026-07-07 14:01:03.629+00
67342	auto.add	{"en": "Add automation", "he": "הוסף אוטומציה", "ru": "Добавить автоматизацию"}	2026-06-19 07:26:25.058709+00	2026-07-07 14:01:03.431+00
67343	auto.history	{"en": "History", "he": "היסטוריה", "ru": "История"}	2026-06-19 07:26:25.061984+00	2026-07-07 14:01:03.434+00
67344	auto.empty	{"en": "No automations yet.", "he": "אין עדיין אוטומציות.", "ru": "Автоматизаций пока нет."}	2026-06-19 07:26:25.064557+00	2026-07-07 14:01:03.438+00
67345	auto.colName	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-19 07:26:25.067664+00	2026-07-07 14:01:03.445+00
67346	auto.colTrigger	{"en": "Trigger", "he": "טריגר", "ru": "Триггер"}	2026-06-19 07:26:25.070533+00	2026-07-07 14:01:03.449+00
67347	auto.colActions	{"en": "Actions", "he": "פעולות", "ru": "Действия"}	2026-06-19 07:26:25.073375+00	2026-07-07 14:01:03.452+00
67348	auto.colActive	{"en": "Active", "he": "פעילה", "ru": "Активна"}	2026-06-19 07:26:25.076063+00	2026-07-07 14:01:03.456+00
67349	auto.new	{"en": "New automation", "he": "אוטומציה חדשה", "ru": "Новая автоматизация"}	2026-06-19 07:26:25.079724+00	2026-07-07 14:01:03.459+00
67350	auto.edit	{"en": "Edit automation", "he": "עריכת אוטומציה", "ru": "Редактировать автоматизацию"}	2026-06-19 07:26:25.082654+00	2026-07-07 14:01:03.463+00
67351	auto.dialogDesc	{"en": "When the trigger fires and the conditions are met, the actions run in order.", "he": "כאשר הטריגר מופעל והתנאים מתקיימים, הפעולות רצות לפי הסדר.", "ru": "Когда срабатывает триггер и выполняются условия — по порядку запускаются действия."}	2026-06-19 07:26:25.086183+00	2026-07-07 14:01:03.465+00
67352	auto.nameOptional	{"en": "Name (optional)", "he": "שם (לא חובה)", "ru": "Название (необязательно)"}	2026-06-19 07:26:25.088755+00	2026-07-07 14:01:03.468+00
67353	auto.activeLabel	{"en": "Active", "he": "פעילה", "ru": "Активна"}	2026-06-19 07:26:25.092005+00	2026-07-07 14:01:03.471+00
67354	auto.trigger	{"en": "Trigger", "he": "טריגר", "ru": "Триггер"}	2026-06-19 07:26:25.095029+00	2026-07-07 14:01:03.475+00
67355	auto.field	{"en": "Field", "he": "שדה", "ru": "Поле"}	2026-06-19 07:26:25.099299+00	2026-07-07 14:01:03.478+00
67356	auto.offsetDays	{"en": "days (− before / + after)", "he": "ימים (− לפני / + אחרי)", "ru": "дней (− до / + после)"}	2026-06-19 07:26:25.105061+00	2026-07-07 14:01:03.481+00
67357	auto.fromStatus	{"en": "From status", "he": "מסטטוס", "ru": "Из статуса"}	2026-06-19 07:26:25.108299+00	2026-07-07 14:01:03.485+00
67358	auto.toStatus	{"en": "To status", "he": "לסטטוס", "ru": "В статус"}	2026-06-19 07:26:25.110713+00	2026-07-07 14:01:03.488+00
67359	auto.anyStatus	{"en": "Any", "he": "כלשהו", "ru": "Любой"}	2026-06-19 07:26:25.114086+00	2026-07-07 14:01:03.491+00
67360	auto.conditions	{"en": "Conditions", "he": "תנאים", "ru": "Условия"}	2026-06-19 07:26:25.117487+00	2026-07-07 14:01:03.494+00
67361	auto.recordStatus	{"en": "Record status", "he": "סטטוס הרשומה", "ru": "Статус записи"}	2026-06-19 07:26:25.120679+00	2026-07-07 14:01:03.508+00
67362	auto.addCondition	{"en": "Add condition", "he": "הוסף תנאי", "ru": "Добавить условие"}	2026-06-19 07:26:25.123474+00	2026-07-07 14:01:03.511+00
67363	auto.actions	{"en": "Actions (in order)", "he": "פעולות (לפי הסדר)", "ru": "Действия (по порядку)"}	2026-06-19 07:26:25.12748+00	2026-07-07 14:01:03.515+00
67364	auto.addAction	{"en": "Add action", "he": "הוסף פעולה", "ru": "Добавить действие"}	2026-06-19 07:26:25.130794+00	2026-07-07 14:01:03.518+00
67365	auto.status	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-06-19 07:26:25.133789+00	2026-07-07 14:01:03.522+00
67366	auto.statusOptional	{"en": "status", "he": "סטטוס", "ru": "статус"}	2026-06-19 07:26:25.136631+00	2026-07-07 14:01:03.525+00
67367	auto.defaultStatus	{"en": "Default", "he": "ברירת מחדל", "ru": "По умолчанию"}	2026-06-19 07:26:25.139548+00	2026-07-07 14:01:03.528+00
67368	auto.targetEntity	{"en": "Entity", "he": "ישות", "ru": "Сущность"}	2026-06-19 07:26:25.141922+00	2026-07-07 14:01:03.531+00
67369	auto.selectEntity	{"en": "Select entity", "he": "בחר ישות", "ru": "Выберите сущность"}	2026-06-19 07:26:25.144722+00	2026-07-07 14:01:03.534+00
67370	auto.matchConditions	{"en": "Record match conditions", "he": "תנאי בחירת רשומות", "ru": "Условия выбора записей"}	2026-06-19 07:26:25.147583+00	2026-07-07 14:01:03.538+00
68755	auto.matchAny	{"en": "any condition (OR)", "he": "תנאי כלשהו (או)", "ru": "любое условие (ИЛИ)"}	2026-06-19 07:41:39.490342+00	2026-07-07 14:01:03.504+00
60789	pivot.defaultRoleVisibilityHint	{"en": "If no roles are selected, the Pivot toggle is visible to everyone with record access. Otherwise only to the selected roles (super admin always sees it). The plain table stays available per record permissions.", "he": "אם לא נבחרו תפקידים, מתג «טבלה מסכמת» גלוי לכל מי שיש לו גישה לרשומות. אחרת רק לתפקידים שנבחרו (מנהל-על תמיד רואה). הטבלה הרגילה נשארת זמינה לפי הרשאות הרשומות.", "ru": "Если роли не выбраны, переключатель «Сводная» виден всем, у кого есть доступ к записям. Иначе — только выбранным ролям (суперадмин видит всегда). Обычная таблица остаётся доступна по правам на записи."}	2026-06-18 16:57:02.331572+00	2026-07-07 14:01:02.973+00
45197	fields.userAllowCreateHint	{"en": "Adds an action to the dropdown for creating a new user. Anyone who can edit records will be able to create users. The new user's role is limited to the roles selected above; an administrative (privileged) role cannot be assigned through a field.", "he": "מוסיף לרשימה הנפתחת פעולה ליצירת משתמש חדש. כל מי שיכול לערוך רשומות יוכל ליצור משתמשים. תפקיד המשתמש החדש מוגבל לתפקידים שנבחרו למעלה; לא ניתן להקצות תפקיד ניהולי (מורשה) דרך שדה.", "ru": "Добавляет в выпадающий список действие для создания нового пользователя. Создавать пользователей сможет любой, у кого есть право редактировать записи. Роль создаваемого пользователя ограничена выбранными выше ролями; назначить административную (привилегированную) роль через поле нельзя."}	2026-06-10 12:35:39.833852+00	2026-07-07 14:00:59.242+00
36047	roles.statusRightsDesc	{"en": "For a chosen entity you can hide individual statuses from this role: \\"Show status\\" — the status is available in the picker and filter; \\"Show rows\\" — records in that status are visible to the role. Everything is enabled by default.", "he": "עבור ישות נבחרת ניתן להסתיר סטטוסים מסוימים מתפקיד זה: «הצג סטטוס» — הסטטוס זמין בבחירה ובסינון; «הצג שורות» — רשומות בסטטוס זה גלויות לתפקיד. הכול מופעל כברירת מחדל.", "ru": "Для выбранной сущности можно скрыть отдельные статусы у этой роли: «Отображать статус» — статус доступен в выборе и фильтре; «Отображать строки» — записи в этом статусе видны роли. По умолчанию включено всё."}	2026-06-09 08:50:23.358076+00	2026-07-07 14:01:01.665+00
70172	auto.pickValue	{"en": "Select value", "he": "בחר ערך", "ru": "Выберите значение"}	2026-06-19 08:05:17.475339+00	2026-07-07 14:01:03.597+00
70173	auto.searchValue	{"en": "Search value…", "he": "חיפוש ערך…", "ru": "Поиск значения…"}	2026-06-19 08:05:17.478289+00	2026-07-07 14:01:03.6+00
67341	auto.subtitle	{"en": "Trigger → conditions → actions. Actions run as the system and can change status bypassing Workflows.", "he": "טריגר → תנאים → פעולות. הפעולות רצות בשם המערכת ויכולות לשנות סטטוס תוך עקיפת התהליכים.", "ru": "Триггер → условия → действия. Действия выполняются от имени системы и могут менять статус в обход «Процессов»."}	2026-06-19 07:26:25.056+00	2026-07-07 14:01:03.427+00
68753	auto.matchLabel	{"en": "Triggers when", "he": "מופעל כאשר מתקיימים", "ru": "Срабатывает, когда выполняется"}	2026-06-19 07:41:39.479686+00	2026-07-07 14:01:03.497+00
68754	auto.matchAll	{"en": "all conditions (AND)", "he": "כל התנאים (וגם)", "ru": "все условия (И)"}	2026-06-19 07:41:39.484662+00	2026-07-07 14:01:03.501+00
70174	auto.noValues	{"en": "No values found", "he": "לא נמצאו ערכים", "ru": "Значения не найдены"}	2026-06-19 08:05:17.48054+00	2026-07-07 14:01:03.603+00
70175	auto.useTyped	{"en": "Use", "he": "השתמש", "ru": "Использовать"}	2026-06-19 08:05:17.483288+00	2026-07-07 14:01:03.607+00
67417	auto.act.update_records_where	{"en": "Update records (by condition)", "he": "עדכן רשומות (לפי תנאי)", "ru": "Обновить записи (по условию)"}	2026-06-19 07:26:25.327308+00	2026-07-07 14:01:03.749+00
67418	auto.act.webhook	{"en": "Webhook", "he": "Webhook", "ru": "Webhook"}	2026-06-19 07:26:25.330954+00	2026-07-07 14:01:03.752+00
73038	colGroups.deleteTitle	{"en": "Delete group?", "he": "למחוק את הקבוצה?", "ru": "Удалить группу?"}	2026-06-21 17:41:58.641461+00	2026-07-07 14:01:03.842+00
73037	colGroups.newTitle	{"en": "New group", "he": "קבוצה חדשה", "ru": "Новая группа"}	2026-06-21 17:41:58.63823+00	2026-07-07 14:01:03.839+00
73040	colGroups.assigned	{"en": "Column group updated", "he": "קבוצת העמודה עודכנה", "ru": "Группа колонки обновлена"}	2026-06-21 17:41:58.652427+00	2026-07-07 14:01:03.85+00
73041	colGroups.assignError	{"en": "Failed to update column group", "he": "עדכון קבוצת העמודה נכשל", "ru": "Не удалось обновить группу колонки"}	2026-06-21 17:41:58.65518+00	2026-07-07 14:01:03.854+00
73042	colGroups.inherit	{"en": "Inherit", "he": "ירושה", "ru": "Наследовать"}	2026-06-21 17:41:58.658385+00	2026-07-07 14:01:03.857+00
73043	colGroups.noGroup	{"en": "No group", "he": "ללא קבוצה", "ru": "Без группы"}	2026-06-21 17:41:58.660836+00	2026-07-07 14:01:03.861+00
73044	colGroups.pick	{"en": "Column group", "he": "קבוצת עמודה", "ru": "Группа колонки"}	2026-06-21 17:41:58.66499+00	2026-07-07 14:01:03.864+00
73046	auto.specifyName	{"en": "Specify the automation name", "he": "ציינו את שם האוטומציה", "ru": "Укажите название автоматизации"}	2026-06-21 17:41:58.670664+00	2026-07-07 14:01:03.889+00
73047	auto.specifySourceField	{"en": "Select a source field", "he": "בחרו שדה מקור", "ru": "Выберите поле-источник"}	2026-06-21 17:41:58.673101+00	2026-07-07 14:01:03.892+00
73048	auto.specifySourceFieldDesc	{"en": "For a condition with the value “From record field”, you must select a source field.", "he": "עבור תנאי עם הערך «משדה הרשומה» יש לבחור שדה מקור.", "ru": "Для условия со значением «Из поля записи» нужно выбрать поле-источник."}	2026-06-21 17:41:58.67623+00	2026-07-07 14:01:03.895+00
73045	records.mirrorOrderSaveError	{"en": "Failed to save column order", "he": "שמירת סדר העמודות נכשלה", "ru": "Не удалось сохранить порядок колонок"}	2026-06-21 17:41:58.667523+00	2026-07-07 14:01:03.902+00
74505	settings.tableHeaderColor	{"en": "Header color", "he": "צבע הכותרת", "ru": "Цвет заголовка"}	2026-06-22 20:20:31.325767+00	2026-07-07 14:01:03.913+00
70911	records.manageAutomations	{"en": "Automations", "he": "אוטומציות", "ru": "Автоматизации"}	2026-06-19 08:10:53.050496+00	2026-07-07 14:01:00.992+00
73013	colGroups.title	{"en": "Column Groups", "he": "קבוצות עמודות", "ru": "Группы колонок"}	2026-06-21 17:41:58.562123+00	2026-07-07 14:01:03.755+00
73014	colGroups.subtitle	{"en": "Global list of groups for styling table columns", "he": "רשימה גלובלית של קבוצות לעיצוב עמודות טבלה", "ru": "Глобальный список групп для оформления колонок таблиц"}	2026-06-21 17:41:58.571937+00	2026-07-07 14:01:03.758+00
73015	colGroups.add	{"en": "Add group", "he": "הוסף קבוצה", "ru": "Добавить группу"}	2026-06-21 17:41:58.574595+00	2026-07-07 14:01:03.761+00
73016	colGroups.col.name	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-21 17:41:58.577558+00	2026-07-07 14:01:03.764+00
73017	colGroups.col.mode	{"en": "Display", "he": "תצוגה", "ru": "Отображение"}	2026-06-21 17:41:58.580007+00	2026-07-07 14:01:03.768+00
73018	colGroups.col.preview	{"en": "Preview", "he": "תצוגה מקדימה", "ru": "Превью"}	2026-06-21 17:41:58.582999+00	2026-07-07 14:01:03.77+00
73019	colGroups.col.actions	{"en": "Actions", "he": "פעולות", "ru": "Действия"}	2026-06-21 17:41:58.585367+00	2026-07-07 14:01:03.778+00
73020	colGroups.empty	{"en": "No groups yet", "he": "אין קבוצות עדיין", "ru": "Групп пока нет"}	2026-06-21 17:41:58.588174+00	2026-07-07 14:01:03.781+00
73021	colGroups.mode.bar	{"en": "Bar", "he": "פס", "ru": "Полоса"}	2026-06-21 17:41:58.590753+00	2026-07-07 14:01:03.784+00
73022	colGroups.mode.fill	{"en": "Fill", "he": "מילוי", "ru": "Заливка"}	2026-06-21 17:41:58.593885+00	2026-07-07 14:01:03.786+00
73023	colGroups.mode.barDesc	{"en": "A thin colored bar is drawn above the column header.", "he": "פס צבעוני דק מצויר מעל כותרת העמודה.", "ru": "Над заголовком колонки рисуется тонкая цветная полоса."}	2026-06-21 17:41:58.596866+00	2026-07-07 14:01:03.79+00
73024	colGroups.mode.fillDesc	{"en": "The column header is filled with the group color.", "he": "כותרת העמודה ממולאת בצבע הקבוצה.", "ru": "Заголовок колонки заливается цветом группы."}	2026-06-21 17:41:58.599585+00	2026-07-07 14:01:03.795+00
73025	colGroups.created	{"en": "Group created", "he": "הקבוצה נוצרה", "ru": "Группа создана"}	2026-06-21 17:41:58.601901+00	2026-07-07 14:01:03.798+00
73026	colGroups.updated	{"en": "Group updated", "he": "הקבוצה עודכנה", "ru": "Группа обновлена"}	2026-06-21 17:41:58.60464+00	2026-07-07 14:01:03.801+00
73027	colGroups.deleted	{"en": "Group deleted", "he": "הקבוצה נמחקה", "ru": "Группа удалена"}	2026-06-21 17:41:58.607042+00	2026-07-07 14:01:03.806+00
73028	colGroups.createError	{"en": "Failed to create group", "he": "יצירת הקבוצה נכשלה", "ru": "Ошибка создания группы"}	2026-06-21 17:41:58.610008+00	2026-07-07 14:01:03.809+00
73029	colGroups.updateError	{"en": "Failed to update group", "he": "עדכון הקבוצה נכשל", "ru": "Ошибка обновления группы"}	2026-06-21 17:41:58.613457+00	2026-07-07 14:01:03.813+00
73030	colGroups.deleteError	{"en": "Failed to delete group", "he": "מחיקת הקבוצה נכשלה", "ru": "Ошибка удаления группы"}	2026-06-21 17:41:58.617141+00	2026-07-07 14:01:03.816+00
73034	colGroups.displayMode	{"en": "Display mode", "he": "מצב תצוגה", "ru": "Режим отображения"}	2026-06-21 17:41:58.628856+00	2026-07-07 14:01:03.829+00
73031	colGroups.nameRequired	{"en": "Name is required", "he": "יש להזין שם", "ru": "Укажите название"}	2026-06-21 17:41:58.619913+00	2026-07-07 14:01:03.819+00
73032	colGroups.name	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-21 17:41:58.62289+00	2026-07-07 14:01:03.822+00
73033	colGroups.color	{"en": "Group color", "he": "צבע הקבוצה", "ru": "Цвет группы"}	2026-06-21 17:41:58.625799+00	2026-07-07 14:01:03.826+00
73036	colGroups.editTitle	{"en": "Edit group", "he": "ערוך קבוצה", "ru": "Редактировать группу"}	2026-06-21 17:41:58.635728+00	2026-07-07 14:01:03.836+00
73035	colGroups.textColor	{"en": "Header text color", "he": "צבע טקסט הכותרת", "ru": "Цвет текста заголовка"}	2026-06-21 17:41:58.631968+00	2026-07-07 14:01:03.833+00
74504	settings.tableStripeColor	{"en": "Stripe color", "he": "צבע הפסים", "ru": "Цвет полосок"}	2026-06-22 20:20:31.323752+00	2026-07-07 14:01:03.916+00
74498	settings.tableStyle	{"en": "Table style", "he": "סגנון הטבלה", "ru": "Стиль таблицы"}	2026-06-22 20:20:31.309381+00	2026-07-07 14:01:03.92+00
73054	auto.allRecordsConfirm	{"en": "I understand that all records will be changed", "he": "אני מבין שכל הרשומות ישתנו", "ru": "Я понимаю, что изменятся все записи"}	2026-06-21 17:41:58.695113+00	2026-07-07 14:01:03.867+00
73053	auto.allRecordsWarn	{"en": "Without selection conditions, this action will change ALL records of the selected entity. Existing values will be overwritten irreversibly.", "he": "ללא תנאי בחירה, פעולה זו תשנה את כל הרשומות של היישות שנבחרה. הערכים הקיימים יוחלפו ללא אפשרות ביטול.", "ru": "Без условий выбора это действие изменит ВСЕ записи выбранной сущности. Существующие значения будут перезаписаны без возможности отмены."}	2026-06-21 17:41:58.69227+00	2026-07-07 14:01:03.87+00
73049	auto.confirmAllNeeded	{"en": "Confirm changing all records", "he": "אשרו שינוי של כל הרשומות", "ru": "Подтвердите изменение всех записей"}	2026-06-21 17:41:58.678508+00	2026-07-07 14:01:03.875+00
73050	auto.confirmAllNeededDesc	{"en": "The “Update records” action without selection conditions will change ALL records of the entity. Check the box to confirm that you understand this.", "he": "הפעולה «עדכון רשומות» ללא תנאי בחירה תשנה את כל הרשומות של היישות. סמנו את האישור שאתם מבינים זאת.", "ru": "Действие «Обновить записи» без условий выбора изменит ВСЕ записи сущности. Отметьте подтверждение, что вы это понимаете."}	2026-06-21 17:41:58.682169+00	2026-07-07 14:01:03.878+00
74502	settings.tableStyleHint	{"en": "Affects how records tables are displayed across the entire platform.", "he": "משפיע על תצוגת טבלאות הרשומות בכל הפלטפורמה.", "ru": "Влияет на отображение таблиц с записями во всей платформе."}	2026-06-22 20:20:31.318687+00	2026-07-07 14:01:03.923+00
74499	settings.tableStylePlain	{"en": "Plain (as now)", "he": "רגיל (כמו עכשיו)", "ru": "Обычный (как сейчас)"}	2026-06-22 20:20:31.311492+00	2026-07-07 14:01:03.927+00
74500	settings.tableStyleStriped	{"en": "Striped rows", "he": "שורות מתחלפות", "ru": "Чередующиеся строки"}	2026-06-22 20:20:31.313867+00	2026-07-07 14:01:03.932+00
74501	settings.tableStyleStripedBold	{"en": "Striped rows + highlighted header", "he": "שורות מתחלפות + כותרת מודגשת", "ru": "Чередующиеся строки + выделенный заголовок"}	2026-06-22 20:20:31.316048+00	2026-07-07 14:01:03.936+00
73051	auto.fromTriggerField	{"en": "From record field", "he": "משדה הרשומה", "ru": "Из поля записи"}	2026-06-21 17:41:58.684655+00	2026-07-07 14:01:03.881+00
73052	auto.nameRequired	{"en": "Name", "he": "שם", "ru": "Название"}	2026-06-21 17:41:58.68958+00	2026-07-07 14:01:03.885+00
74503	settings.tableColorsHint	{"en": "Records table colors (optional). If not set, the default grays are used.", "he": "צבעי טבלת הרשומות (אופציונלי). אם לא הוגדרו, נעשה שימוש באפור ברירת המחדל.", "ru": "Цвета таблицы записей (необязательно). Если не заданы, используются стандартные серые."}	2026-06-22 20:20:31.321175+00	2026-07-07 14:01:03.909+00
73705	records.dateHasRecords	{"en": "Has records", "he": "יש רשומות", "ru": "Есть записи"}	2026-06-22 20:20:28.583007+00	2026-07-07 14:01:00.614+00
73039	colGroups.deleteDesc	{"en": "Columns assigned to this group will simply stop showing the styling. This action cannot be undone.", "he": "עמודות המשויכות לקבוצה זו פשוט יפסיקו להציג את העיצוב. לא ניתן לבטל פעולה זו.", "ru": "Колонки, привязанные к этой группе, просто перестанут показывать оформление. Это действие нельзя отменить."}	2026-06-21 17:41:58.64937+00	2026-07-07 14:01:03.845+00
74506	settings.tableBorderColor	{"en": "Line color", "he": "צבע הקווים", "ru": "Цвет линий"}	2026-06-22 20:20:31.328482+00	2026-07-07 14:01:03.906+00
76282	fields.vop.notEquals	{"en": "not equals", "he": "לא שווה", "ru": "не равно"}	2026-06-23 10:58:42.515508+00	2026-07-07 14:00:58.917+00
76283	fields.vop.gt	{"en": "greater than", "he": "גדול מ-", "ru": "больше"}	2026-06-23 10:58:42.517824+00	2026-07-07 14:00:58.919+00
76284	fields.vop.lt	{"en": "less than", "he": "קטן מ-", "ru": "меньше"}	2026-06-23 10:58:42.521378+00	2026-07-07 14:00:58.922+00
76285	fields.vop.gte	{"en": "greater or equal", "he": "גדול או שווה", "ru": "больше или равно"}	2026-06-23 10:58:42.526586+00	2026-07-07 14:00:58.925+00
76286	fields.vop.lte	{"en": "less or equal", "he": "קטן או שווה", "ru": "меньше или равно"}	2026-06-23 10:58:42.529348+00	2026-07-07 14:00:58.928+00
76271	fields.validationRules	{"en": "Fill rules", "he": "כללי מילוי", "ru": "Правила заполнения"}	2026-06-23 10:58:42.471931+00	2026-07-07 14:00:58.879+00
76272	fields.validationRulesHint	{"en": "Block saving this field until another field satisfies the condition. The error message is generated automatically.", "he": "חסימת שמירת שדה זה עד ששדה אחר עומד בתנאי. הודעת השגיאה נוצרת אוטומטית.", "ru": "Запрет на сохранение этого поля, пока другое поле не удовлетворяет условию. Текст ошибки формируется автоматически."}	2026-06-23 10:58:42.480095+00	2026-07-07 14:00:58.882+00
76273	fields.validationNoOther	{"en": "Add other fields to this entity first.", "he": "הוסף תחילה שדות אחרים לישות זו.", "ru": "Сначала добавьте другие поля в эту сущность."}	2026-06-23 10:58:42.484537+00	2026-07-07 14:00:58.885+00
76287	fields.vop.between	{"en": "between", "he": "בטווח", "ru": "в диапазоне"}	2026-06-23 10:58:42.532366+00	2026-07-07 14:00:58.931+00
78522	views.columns	{"en": "Displayed columns", "he": "עמודות מוצגות", "ru": "Отображаемые столбцы"}	2026-06-26 08:04:41.371052+00	2026-07-07 14:01:02.487+00
78523	views.columnsShowAll	{"en": "Show all", "he": "הצג הכול", "ru": "Показать все"}	2026-06-26 08:04:41.377072+00	2026-07-07 14:01:02.49+00
79996	views.columnsAll	{"en": "all", "he": "הכול", "ru": "все"}	2026-06-26 08:18:01.683771+00	2026-07-07 14:01:02.493+00
79997	views.columnsSelectedCount	{"en": "selected: {n}", "he": "נבחרו: {n}", "ru": "выбрано: {n}"}	2026-06-26 08:18:01.69032+00	2026-07-07 14:01:02.496+00
78524	views.columnsHint	{"en": "None selected — all default columns are shown. A selection only narrows the set within the columns available to you.", "he": "לא נבחר דבר — כל עמודות ברירת המחדל מוצגות. בחירה רק מצמצמת את הסט בגבולות העמודות הזמינות לך.", "ru": "Не выбрано ни одного — показываются все столбцы по умолчанию. Выбор только сужает набор в пределах доступных вам столбцов."}	2026-06-26 08:04:41.379753+00	2026-07-07 14:01:02.499+00
81749	auto.combined	{"en": "Combined", "he": "משולב", "ru": "Комбинированное"}	2026-06-30 15:10:51.178075+00	2026-07-07 14:01:03.555+00
76274	fields.validationApplyTo	{"en": "Apply only to values (empty = any):", "he": "החל רק על ערכים (ריק = כל ערך):", "ru": "Применять только к значениям (пусто = к любому):"}	2026-06-23 10:58:42.487881+00	2026-07-07 14:00:58.889+00
76275	fields.validationCondField	{"en": "Condition field", "he": "שדה תנאי", "ru": "Поле-условие"}	2026-06-23 10:58:42.490808+00	2026-07-07 14:00:58.893+00
76276	fields.addValidationRule	{"en": "Add rule", "he": "הוסף כלל", "ru": "Добавить правило"}	2026-06-23 10:58:42.494183+00	2026-07-07 14:00:58.897+00
76277	fields.valFrom	{"en": "from", "he": "מ-", "ru": "от"}	2026-06-23 10:58:42.497653+00	2026-07-07 14:00:58.899+00
76278	fields.valTo	{"en": "to", "he": "עד", "ru": "до"}	2026-06-23 10:58:42.503058+00	2026-07-07 14:00:58.904+00
76279	fields.vop.empty	{"en": "is empty", "he": "ריק", "ru": "пусто"}	2026-06-23 10:58:42.506422+00	2026-07-07 14:00:58.907+00
76280	fields.vop.notEmpty	{"en": "is filled", "he": "מלא", "ru": "заполнено"}	2026-06-23 10:58:42.509536+00	2026-07-07 14:00:58.91+00
76281	fields.vop.equals	{"en": "equals", "he": "שווה", "ru": "равно"}	2026-06-23 10:58:42.513046+00	2026-07-07 14:00:58.913+00
81750	auto.combinedTemplate	{"en": "Value template", "he": "תבנית ערך", "ru": "Шаблон значения"}	2026-06-30 15:10:51.18381+00	2026-07-07 14:01:03.557+00
81753	auto.combinedHint	{"en": "Free text + record field values via {field_key}. Substituted when the automation runs.", "he": "טקסט חופשי + ערכי שדות הרשומה דרך {field_key}. מוחלפים בעת הפעלת האוטומציה.", "ru": "Свободный текст + значения полей записи через {ключ_поля}. Подставляются при срабатывании автоматизации."}	2026-06-30 15:10:51.194825+00	2026-07-07 14:01:03.57+00
86295	import.title	{"en": "Data Import", "he": "ייבוא נתונים", "ru": "Импорт данных"}	2026-06-30 16:27:13.689223+00	2026-07-07 14:01:03.939+00
86296	import.subtitle	{"en": "Load records from an XLSX/CSV file, validated against the entity's rules", "he": "טעינת רשומות מקובץ XLSX/CSV עם אימות לפי כללי הישות", "ru": "Загрузка записей из файла XLSX/CSV с проверкой по правилам сущности"}	2026-06-30 16:27:13.693978+00	2026-07-07 14:01:03.942+00
86297	import.step1	{"en": "1. Choose an entity", "he": "1. בחר ישות", "ru": "1. Выберите сущность"}	2026-06-30 16:27:13.696225+00	2026-07-07 14:01:03.945+00
86298	import.pickEntity	{"en": "Entity…", "he": "ישות…", "ru": "Сущность…"}	2026-06-30 16:27:13.699476+00	2026-07-07 14:01:03.949+00
86299	import.step2	{"en": "2. Template & file", "he": "2. תבנית וקובץ", "ru": "2. Шаблон и файл"}	2026-06-30 16:27:13.701875+00	2026-07-07 14:01:03.952+00
86300	import.downloadTemplate	{"en": "Download template", "he": "הורד תבנית", "ru": "Скачать шаблон"}	2026-06-30 16:27:13.704632+00	2026-07-07 14:01:03.956+00
83706	fields.wrapText	{"en": "Wrap text in this column", "he": "גלישת טקסט בעמודה זו", "ru": "Переносить текст в столбце на новую строку"}	2026-06-30 15:35:32.152461+00	2026-07-07 14:00:59.094+00
27264	fileTrash.purgeError	{"en": "Failed to empty trash", "he": "ריקון הסל נכשל", "ru": "Не удалось очистить корзину"}	2026-06-08 16:12:01.468854+00	2026-07-07 14:00:59.313+00
86301	import.uploadFile	{"en": "Upload file", "he": "העלה קובץ", "ru": "Загрузить файл"}	2026-06-30 16:27:13.706894+00	2026-07-07 14:01:03.959+00
86302	import.rowsCount	{"en": "rows", "he": "שורות", "ru": "строк"}	2026-06-30 16:27:13.709744+00	2026-07-07 14:01:03.962+00
86303	import.parseError	{"en": "Could not read the file", "he": "לא ניתן לקרוא את הקובץ", "ru": "Не удалось прочитать файл"}	2026-06-30 16:27:13.71271+00	2026-07-07 14:01:03.965+00
86304	import.step3	{"en": "3. Column mapping", "he": "3. מיפוי עמודות", "ru": "3. Сопоставление колонок"}	2026-06-30 16:27:13.716193+00	2026-07-07 14:01:03.969+00
86305	import.column	{"en": "File column", "he": "עמודת הקובץ", "ru": "Колонка файла"}	2026-06-30 16:27:13.718648+00	2026-07-07 14:01:03.971+00
86306	import.sample	{"en": "Sample", "he": "דוגמה", "ru": "Пример"}	2026-06-30 16:27:13.721957+00	2026-07-07 14:01:03.974+00
111	statuses.archiveRecords	{"en": "Archive records in this status", "he": "העבר לארכיון רשומות בסטטוס זה", "ru": "Архивировать записи в этом статусе"}	2026-06-05 11:02:47.35127+00	2026-07-07 14:01:01.877+00
83230	auto.combinedTemplateBelow	{"en": "Template below", "he": "תבנית למטה", "ru": "Шаблон ниже"}	2026-06-30 15:17:37.794404+00	2026-07-07 14:01:03.561+00
81751	auto.combinedPlaceholder	{"en": "Delivered to paint shop ({painter})", "he": "נמסר למפעל הצביעה ({painter})", "ru": "Доставлено в покрасочную ({painter})"}	2026-06-30 15:10:51.188019+00	2026-07-07 14:01:03.564+00
81752	auto.combinedInsert	{"en": "Insert field:", "he": "הוסף שדה:", "ru": "Вставить поле:"}	2026-06-30 15:10:51.192023+00	2026-07-07 14:01:03.568+00
86308	import.targetKey	{"en": "Match by field", "he": "התאמה לפי שדה", "ru": "Поиск по полю"}	2026-06-30 16:27:13.727381+00	2026-07-07 14:01:03.98+00
86314	import.upsertHint	{"en": "Matching records are updated, the rest are inserted", "he": "רשומות תואמות יעודכנו, השאר יתווספו", "ru": "Совпадающие записи будут обновлены, остальные — добавлены"}	2026-06-30 16:27:13.745683+00	2026-07-07 14:01:04+00
86317	import.missingTargetKey	{"en": "Choose a match field for the relation", "he": "בחר שדה התאמה לקשר", "ru": "Выберите поле поиска для связи"}	2026-06-30 16:27:13.754989+00	2026-07-07 14:01:04.01+00
86321	import.resultPreview	{"en": "Validation result", "he": "תוצאת האימות", "ru": "Результат проверки"}	2026-06-30 16:27:13.768382+00	2026-07-07 14:01:04.023+00
86326	import.skipped	{"en": "Skipped", "he": "דולגו", "ru": "Пропущено"}	2026-06-30 16:27:13.782235+00	2026-07-07 14:01:04.041+00
86327	import.errors	{"en": "Errors", "he": "שגיאות", "ru": "Ошибок"}	2026-06-30 16:27:13.785033+00	2026-07-07 14:01:04.044+00
86332	import.downloadErrors	{"en": "Download error report", "he": "הורד דוח שגיאות", "ru": "Скачать отчёт об ошибках"}	2026-06-30 16:27:13.799021+00	2026-07-07 14:01:04.061+00
86333	import.allOkPreview	{"en": "No errors — ready to import", "he": "אין שגיאות — מוכן לייבוא", "ru": "Ошибок не найдено — можно импортировать"}	2026-06-30 16:27:13.801519+00	2026-07-07 14:01:04.071+00
86334	import.allOkCommit	{"en": "All rows imported without errors", "he": "כל השורות יובאו ללא שגיאות", "ru": "Все строки импортированы без ошибок"}	2026-06-30 16:27:13.804349+00	2026-07-07 14:01:04.074+00
87038	records.showHidden	{"en": "Show hidden", "he": "הצג מוסתרים", "ru": "Показать скрытые"}	2026-07-01 14:44:23.700072+00	2026-07-07 14:01:00.743+00
87041	records.pageDefaultFilterCurrent	{"en": "Will be saved", "he": "יישמר", "ru": "Будет сохранено"}	2026-07-01 14:44:23.714311+00	2026-07-07 14:01:00.752+00
87042	records.pageDefaultFilterEmpty	{"en": "No filters selected — nothing to save.", "he": "לא נבחרו מסננים — אין מה לשמור.", "ru": "Сейчас фильтры не выбраны — сохранять нечего."}	2026-07-01 14:44:23.718238+00	2026-07-07 14:01:00.756+00
87044	records.pageDefaultFilterSave	{"en": "Save current filters as the default filter", "he": "שמור את המסננים הנוכחיים כמסנן ברירת מחדל", "ru": "Сохранить текущие фильтры как фильтр по умолчанию"}	2026-07-01 14:44:23.724029+00	2026-07-07 14:01:00.764+00
86309	import.pickTargetKey	{"en": "Field to match…", "he": "שדה להתאמה…", "ru": "Поле для поиска…"}	2026-06-30 16:27:13.729831+00	2026-07-07 14:01:03.983+00
86310	import.ignore	{"en": "— Skip —", "he": "— דלג —", "ru": "— Пропустить —"}	2026-06-30 16:27:13.733234+00	2026-07-07 14:01:03.986+00
86315	import.preview	{"en": "Validate (dry run)", "he": "בדוק (ללא כתיבה)", "ru": "Проверить (без записи)"}	2026-06-30 16:27:13.748438+00	2026-07-07 14:01:04.003+00
86318	import.previewError	{"en": "Validation failed", "he": "האימות נכשל", "ru": "Ошибка проверки"}	2026-06-30 16:27:13.75794+00	2026-07-07 14:01:04.014+00
86322	import.resultCommit	{"en": "Import result", "he": "תוצאת הייבוא", "ru": "Результат импорта"}	2026-06-30 16:27:13.771233+00	2026-07-07 14:01:04.026+00
86328	import.row	{"en": "Row", "he": "שורה", "ru": "Строка"}	2026-06-30 16:27:13.787936+00	2026-07-07 14:01:04.047+00
86329	import.statusCol	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-06-30 16:27:13.790082+00	2026-07-07 14:01:04.05+00
86330	import.error	{"en": "Error", "he": "שגיאה", "ru": "Ошибка"}	2026-06-30 16:27:13.793086+00	2026-07-07 14:01:04.054+00
87039	records.pageDefaultFilterTitle	{"en": "Default filter for this page", "he": "מסנן ברירת מחדל לעמוד זה", "ru": "Фильтр по умолчанию для этой страницы"}	2026-07-01 14:44:23.708421+00	2026-07-07 14:01:00.746+00
87043	records.pageDefaultFilterStored	{"en": "A default filter is already set for this page.", "he": "כבר הוגדר מסנן ברירת מחדל לעמוד זה.", "ru": "Для страницы уже задан фильтр по умолчанию."}	2026-07-01 14:44:23.720996+00	2026-07-07 14:01:00.76+00
87045	records.pageDefaultFilterClear	{"en": "Clear default filter", "he": "נקה מסנן ברירת מחדל", "ru": "Очистить фильтр по умолчанию"}	2026-07-01 14:44:23.72625+00	2026-07-07 14:01:00.766+00
87046	records.pageDefaultFilterSaved	{"en": "Default filter saved", "he": "מסנן ברירת המחדל נשמר", "ru": "Фильтр по умолчанию сохранён"}	2026-07-01 14:44:23.728993+00	2026-07-07 14:01:00.773+00
86311	import.status	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-06-30 16:27:13.736083+00	2026-07-07 14:01:03.989+00
86316	import.commit	{"en": "Import", "he": "ייבא", "ru": "Импортировать"}	2026-06-30 16:27:13.752233+00	2026-07-07 14:01:04.007+00
86319	import.commitError	{"en": "Import failed", "he": "הייבוא נכשל", "ru": "Ошибка импорта"}	2026-06-30 16:27:13.761374+00	2026-07-07 14:01:04.017+00
86320	import.done	{"en": "Import complete", "he": "הייבוא הושלם", "ru": "Импорт завершён"}	2026-06-30 16:27:13.766029+00	2026-07-07 14:01:04.02+00
86323	import.total	{"en": "Total", "he": "סה״כ", "ru": "Всего"}	2026-06-30 16:27:13.773998+00	2026-07-07 14:01:04.03+00
86324	import.created	{"en": "Created", "he": "נוצרו", "ru": "Создано"}	2026-06-30 16:27:13.77695+00	2026-07-07 14:01:04.034+00
86313	import.insertOnly	{"en": "No update (insert only)", "he": "ללא עדכון (הוספה בלבד)", "ru": "Без обновления (только добавление)"}	2026-06-30 16:27:13.742424+00	2026-07-07 14:01:03.996+00
86325	import.updated	{"en": "Updated", "he": "עודכנו", "ru": "Обновлено"}	2026-06-30 16:27:13.779389+00	2026-07-07 14:01:04.037+00
86331	import.message	{"en": "Message", "he": "הודעה", "ru": "Сообщение"}	2026-06-30 16:27:13.795658+00	2026-07-07 14:01:04.058+00
103516	records.groupCollapseAll	{"en": "Collapse all groups", "he": "כווץ את כל הקבוצות", "ru": "Свернуть все группы"}	2026-07-06 09:59:29.476769+00	2026-07-07 14:01:04.327+00
87869	fields.defaultToToday	{"en": "Default to today's date", "he": "ברירת מחדל — התאריך הנוכחי", "ru": "По умолчанию — текущая дата"}	2026-07-01 14:44:26.609715+00	2026-07-07 14:01:01.83+00
87870	fields.optionsMlHint	{"en": "Each option can be defined in several languages. The value stored in records does not change when renamed.", "he": "ניתן להגדיר כל אפשרות בכמה שפות. הערך השמור ברשומות אינו משתנה בעת שינוי שם.", "ru": "Каждый вариант можно задать на нескольких языках. Значение в записях не меняется при переименовании."}	2026-07-01 14:44:26.612403+00	2026-07-07 14:01:01.833+00
87871	fields.optionLabel	{"en": "Option", "he": "אפשרות", "ru": "Вариант"}	2026-07-01 14:44:26.618955+00	2026-07-07 14:01:01.837+00
87872	fields.noOptionsYet	{"en": "No options yet.", "he": "אין אפשרויות עדיין.", "ru": "Вариантов пока нет."}	2026-07-01 14:44:26.621491+00	2026-07-07 14:01:01.841+00
87873	fields.addOption	{"en": "Add option", "he": "הוסף אפשרות", "ru": "Добавить вариант"}	2026-07-01 14:44:26.624345+00	2026-07-07 14:01:01.844+00
87876	import.badValueTitle	{"en": "Invalid value", "he": "ערך לא חוקי", "ru": "Недопустимое значение"}	2026-07-01 14:44:26.63383+00	2026-07-07 14:01:01.847+00
87877	import.badValueMsg	{"en": "Select a value from the list", "he": "בחר ערך מהרשימה", "ru": "Выберите значение из списка"}	2026-07-01 14:44:26.636852+00	2026-07-07 14:01:01.851+00
103517	records.groupExpandAll	{"en": "Expand all groups", "he": "הרחב את כל הקבוצות", "ru": "Развернуть все группы"}	2026-07-06 09:59:29.479926+00	2026-07-07 14:01:04.329+00
103518	records.groupDefaultExpandedSaved	{"en": "Default: all groups expanded", "he": "ברירת מחדל: כל הקבוצות מורחבות", "ru": "По умолчанию: все группы развёрнуты"}	2026-07-06 09:59:29.482962+00	2026-07-07 14:01:04.333+00
87047	records.pageDefaultFilterCleared	{"en": "Default filter cleared", "he": "מסנן ברירת המחדל נוקה", "ru": "Фильтр по умолчанию очищен"}	2026-07-01 14:44:23.731193+00	2026-07-07 14:01:00.919+00
87048	records.pageExcludeTitle	{"en": "Hide rows by default (except…)", "he": "הסתר שורות כברירת מחדל (חוץ מ…)", "ru": "Скрывать строки по умолчанию (кроме…)"}	2026-07-01 14:44:23.733282+00	2026-07-07 14:01:00.923+00
87050	records.pageExcludeSelected	{"en": "Values to be hidden", "he": "ערכים שיוסתרו", "ru": "Будет скрыто значений"}	2026-07-01 14:44:23.738943+00	2026-07-07 14:01:00.929+00
87878	import.templateError	{"en": "Failed to create template", "he": "יצירת התבנית נכשלה", "ru": "Не удалось создать шаблон"}	2026-07-01 14:44:26.639927+00	2026-07-07 14:01:01.854+00
86307	import.mapTo	{"en": "Field / relation / status", "he": "שדה / קשר / סטטוס", "ru": "Поле / связь / статус"}	2026-06-30 16:27:13.724486+00	2026-07-07 14:01:03.977+00
86312	import.upsertKey	{"en": "Update key (upsert)", "he": "מפתח עדכון (upsert)", "ru": "Ключ для обновления (upsert)"}	2026-06-30 16:27:13.739307+00	2026-07-07 14:01:03.993+00
87874	statuses.allowNoStatus	{"en": "Allow the “No status” option", "he": "אפשר את האפשרות «ללא סטטוס»", "ru": "Разрешить вариант «Без статуса»"}	2026-07-01 14:44:26.62647+00	2026-07-07 14:01:01.822+00
87875	statuses.allowNoStatusHint	{"en": "If disabled, the “No status” option won't appear when choosing a record's status.", "he": "אם מושבת, האפשרות «ללא סטטוס» לא תוצג בעת בחירת סטטוס של רשומה.", "ru": "Если выключено, вариант «Без статуса» не будет показываться при выборе статуса записи."}	2026-07-01 14:44:26.629407+00	2026-07-07 14:01:01.826+00
103515	records.groupDefaultStateHint	{"en": "How groups appear when this page opens. Users can toggle it manually.", "he": "כיצד הקבוצות יוצגו בפתיחת עמוד זה. המשתמש יכול לשנות זאת ידנית.", "ru": "Как группы будут показаны при открытии этой страницы. Пользователь сможет переключить вручную."}	2026-07-06 09:59:29.473025+00	2026-07-07 14:01:04.323+00
94067	dash.pivotPageContext	{"en": "Page (for page fields)", "he": "עמוד (לשדות עמוד)", "ru": "Страница (для полей страницы)"}	2026-07-02 20:10:53.555439+00	2026-07-07 14:01:04.283+00
94467	fields.percentDecimalsHint	{"en": "Rounding for display. Column total is the average.", "he": "עיגול לתצוגה. הסיכום בעמודה הוא הממוצע.", "ru": "Округление при отображении. Итог по столбцу — среднее значение."}	2026-07-05 20:53:49.620453+00	2026-07-07 14:00:59.171+00
91556	pages.groupByNone	{"en": "— No grouping —", "he": "— ללא קיבוץ —", "ru": "— Без группировки —"}	2026-07-02 14:21:06.598534+00	2026-07-07 14:01:00.301+00
87049	records.pageExcludeHint	{"en": "Select the values whose rows should be hidden when the page opens. The user can reveal them with the “Show hidden” checkbox. Hiding can never reveal rows disallowed by the view's filter.", "he": "בחרו את הערכים שהשורות שלהם יוסתרו בעת פתיחת העמוד. המשתמש יוכל לחשוף אותם באמצעות תיבת הסימון «הצג מוסתרים». ההסתרה לעולם אינה יכולה לחשוף שורות שאינן מותרות על ידי מסנן התצוגה.", "ru": "Отметьте значения, строки с которыми нужно скрыть при открытии страницы. Пользователь сможет показать их галочкой «Показать скрытые». Скрытие не может показать строки, запрещённые фильтром вида."}	2026-07-01 14:44:23.736089+00	2026-07-07 14:01:00.927+00
91691	records.groupEmpty	{"en": "No value", "he": "ללא ערך", "ru": "Без значения"}	2026-07-02 14:21:07.075048+00	2026-07-07 14:01:00.95+00
94068	dash.pivotPageNone	{"en": "No page", "he": "ללא עמוד", "ru": "Без страницы"}	2026-07-02 20:10:53.558638+00	2026-07-07 14:01:04.287+00
94070	dash.tableNeedsPage	{"en": "Select a page for page fields", "he": "בחרו עמוד לשדות עמוד", "ru": "Выберите страницу для полей страницы"}	2026-07-02 20:10:53.565023+00	2026-07-07 14:01:04.293+00
94470	fields.percentOptionAdd	{"en": "Add option", "he": "הוסף אפשרות", "ru": "Добавить вариант"}	2026-07-05 20:53:49.630236+00	2026-07-07 14:00:59.183+00
91554	pages.groupBy	{"en": "Group by", "he": "קבץ לפי", "ru": "Группировать по"}	2026-07-02 14:21:06.586972+00	2026-07-07 14:01:00.293+00
103520	records.mirrorColSaved	{"en": "Column settings updated", "he": "הגדרות העמודה עודכנו", "ru": "Настройки колонки обновлены"}	2026-07-06 09:59:29.488928+00	2026-07-07 14:01:04.339+00
103524	records.pinColumn	{"en": "Pin column", "he": "הצמד עמודה", "ru": "Закрепить колонку"}	2026-07-06 09:59:29.501022+00	2026-07-07 14:01:04.361+00
94463	fields.percentMode	{"en": "Input mode", "he": "מצב קלט", "ru": "Режим ввода"}	2026-07-05 20:53:49.608893+00	2026-07-07 14:00:59.157+00
94464	fields.percentModeValue	{"en": "Value (numeric entry)", "he": "ערך (הזנת מספר)", "ru": "Значение (ввод числа)"}	2026-07-05 20:53:49.611123+00	2026-07-07 14:00:59.159+00
94468	fields.percentOptions	{"en": "Options (numbers)", "he": "אפשרויות (מספרים)", "ru": "Варианты (числа)"}	2026-07-05 20:53:49.622836+00	2026-07-07 14:00:59.174+00
94469	fields.percentOptionsHint	{"en": "Each option is a number (e.g. 25 or 12.5). Shown in the list as \\"25%\\".", "he": "כל אפשרות היא מספר (למשל 25 או 12.5). מוצג ברשימה כ-\\"25%\\".", "ru": "Каждый вариант — число (например 25 или 12.5). В списке показывается как «25%»."}	2026-07-05 20:53:49.626779+00	2026-07-07 14:00:59.181+00
91555	pages.groupByHint	{"en": "Records will be grouped by this field's value: collapsed groups with a count and sums (for fields with \\"Column total\\" enabled).", "he": "הרשומות יקובצו לפי ערך שדה זה: קבוצות מכווצות עם ספירה וסכומים (לשדות עם \\"סיכום עמודה\\" מופעל).", "ru": "Записи будут сгруппированы по значению этого поля: свёрнутые группы с количеством и суммами (для полей с включённым «Итог по колонке»)."}	2026-07-02 14:21:06.595297+00	2026-07-07 14:01:00.297+00
90778	calendar.statusLabel	{"en": "Status", "he": "סטטוס", "ru": "Статус"}	2026-07-01 18:19:19.443029+00	2026-07-07 14:01:03.39+00
113388	import.templateHint	{"en": "Download the template, fill it in, then upload the filled file", "he": "הורידו את התבנית, מלאו אותה והעלו את הקובץ הממולא", "ru": "Скачайте шаблон, заполните его и загрузите заполненный файл"}	2026-07-07 14:01:04.102552+00	2026-07-07 14:01:04.102552+00
94066	dash.tablePageColumns	{"en": "Page fields", "he": "שדות עמוד", "ru": "Поля страницы"}	2026-07-02 20:10:53.549548+00	2026-07-07 14:01:04.281+00
94465	fields.percentModeList	{"en": "List (select from options)", "he": "רשימה (בחירה מאפשרויות)", "ru": "Список (выбор из вариантов)"}	2026-07-05 20:53:49.614318+00	2026-07-07 14:00:59.163+00
94069	dash.pivotNeedsPage	{"en": "Select a page for page fields", "he": "בחרו עמוד לשדות עמוד", "ru": "Выберите страницу для полей страницы"}	2026-07-02 20:10:53.561059+00	2026-07-07 14:01:04.29+00
94071	pivot.pageFieldSuffix	{"en": "page field", "he": "שדה עמוד", "ru": "поле страницы"}	2026-07-02 20:10:53.567659+00	2026-07-07 14:01:04.296+00
94466	fields.percentDecimals	{"en": "Decimal places (rounding)", "he": "מספר ספרות אחרי הנקודה (עיגול)", "ru": "Знаков после запятой (округление)"}	2026-07-05 20:53:49.616949+00	2026-07-07 14:00:59.166+00
103525	records.pinColumnHint	{"en": "The column will not scroll horizontally", "he": "העמודה לא תיגלל אופקית", "ru": "Колонка не будет прокручиваться по горизонтали"}	2026-07-06 09:59:29.503925+00	2026-07-07 14:01:04.364+00
94462	fields.type.percent	{"en": "Percent", "he": "אחוזים", "ru": "Проценты"}	2026-07-05 20:53:49.60189+00	2026-07-07 14:00:59.153+00
103519	records.groupDefaultCollapsedSaved	{"en": "Default: all groups collapsed", "he": "ברירת מחדל: כל הקבוצות מכווצות", "ru": "По умолчанию: все группы свёрнуты"}	2026-07-06 09:59:29.485607+00	2026-07-07 14:01:04.335+00
103512	pages.groupCollapseAll	{"en": "Collapse all groups", "he": "כווץ את כל הקבוצות", "ru": "Свернуть все группы"}	2026-07-06 09:59:29.463507+00	2026-07-07 14:01:04.313+00
103513	pages.groupExpandAll	{"en": "Expand all groups", "he": "הרחב את כל הקבוצות", "ru": "Развернуть все группы"}	2026-07-06 09:59:29.466653+00	2026-07-07 14:01:04.317+00
108397	cf.page	{"en": "Page", "he": "עמוד", "ru": "Страница"}	2026-07-07 09:44:01.80317+00	2026-07-07 14:01:04.513+00
101824	auto.noMirrorPages	{"en": "No mirror pages of this entity with page fields.", "he": "אין עמודי מראה של ישות זו עם שדות עמוד.", "ru": "Нет зеркальных страниц этой сущности с полями страницы."}	2026-07-05 22:31:06.861924+00	2026-07-07 14:01:03.732+00
101930	auto.specifyPage	{"en": "Specify the trigger page", "he": "ציין את עמוד הטריגר", "ru": "Укажите страницу триггера"}	2026-07-05 22:31:07.355741+00	2026-07-07 14:01:04.299+00
101931	auto.specifyPageField	{"en": "Specify the page field", "he": "ציין את שדה העמוד", "ru": "Укажите поле страницы"}	2026-07-05 22:31:07.360926+00	2026-07-07 14:01:04.302+00
103510	pages.groupDefaultState	{"en": "Default group state", "he": "מצב ברירת מחדל של קבוצות", "ru": "Состояние групп по умолчанию"}	2026-07-06 09:59:29.454465+00	2026-07-07 14:01:04.306+00
103514	records.groupDefaultStateTitle	{"en": "Default group state", "he": "מצב ברירת מחדל של קבוצות", "ru": "Состояние групп по умолчанию"}	2026-07-06 09:59:29.470349+00	2026-07-07 14:01:04.32+00
95638	records.pageRequiredField	{"en": "Required field", "he": "שדה חובה", "ru": "Обязательное поле"}	2026-07-05 20:53:53.72315+00	2026-07-07 14:01:04.355+00
108392	cf.noInputsShort	{"en": "Add an input first", "he": "הוסף קלט תחילה", "ru": "Сначала добавьте ввод"}	2026-07-07 09:44:01.786958+00	2026-07-07 14:01:04.498+00
108393	cf.noInputs	{"en": "No inputs — all conditions compare against fixed values.", "he": "אין קלטים — כל התנאים משווים לערכים קבועים.", "ru": "Вводов нет — все условия сравнивают с фиксированными значениями."}	2026-07-07 09:44:01.789537+00	2026-07-07 14:01:04.501+00
103511	pages.groupDefaultHint	{"en": "How groups appear when the page opens. Users can toggle it manually.", "he": "כיצד הקבוצות יוצגו בפתיחת העמוד. המשתמש יכול לשנות זאת ידנית.", "ru": "Как группы будут показаны при открытии страницы. Пользователь может переключить вручную."}	2026-07-06 09:59:29.459615+00	2026-07-07 14:01:04.31+00
95636	records.pageRequiredTitle	{"en": "Fill in the required fields", "he": "מלא את השדות הנדרשים", "ru": "Заполните обязательные поля"}	2026-07-05 20:53:53.716272+00	2026-07-07 14:01:04.342+00
95637	records.pageRequiredDesc	{"en": "All required fields must be filled in. Complete them and save.", "he": "יש למלא את כל השדות הנדרשים. מלא אותם ושמור.", "ru": "Все обязательные поля должны быть заполнены. Заполните их и сохраните."}	2026-07-05 20:53:53.719451+00	2026-07-07 14:01:04.347+00
108394	cf.no	{"en": "No", "he": "לא", "ru": "Нет"}	2026-07-07 09:44:01.792961+00	2026-07-07 14:01:04.504+00
108395	cf.pageFieldMissing	{"en": "Select a page and field", "he": "בחר עמוד ושדה", "ru": "Выберите страницу и поле"}	2026-07-07 09:44:01.796242+00	2026-07-07 14:01:04.507+00
108398	cf.pickInput	{"en": "Select input", "he": "בחר קלט", "ru": "Выберите ввод"}	2026-07-07 09:44:01.806301+00	2026-07-07 14:01:04.515+00
97519	fields.formatValueFrom	{"en": "from", "he": "מ", "ru": "от"}	2026-07-05 21:38:49.085728+00	2026-07-07 14:00:58.872+00
97520	fields.formatValueTo	{"en": "to", "he": "עד", "ru": "до"}	2026-07-05 21:38:49.090507+00	2026-07-07 14:00:58.875+00
97562	fields.op.between	{"en": "in range", "he": "בטווח", "ru": "в диапазоне"}	2026-07-05 21:38:49.212719+00	2026-07-07 14:00:59.017+00
96007	fields.showColumnAvg	{"en": "Show column average", "he": "הצג ממוצע עמודה", "ru": "Показывать среднее по колонке"}	2026-07-05 21:10:23.595939+00	2026-07-07 14:00:59.076+00
104254	records.customFiltersTitle	{"en": "Custom filters (multiple fields)", "he": "מסננים מותאמים אישית (מספר שדות)", "ru": "Пользовательские фильтры (несколько полей)"}	2026-07-07 07:44:03.881143+00	2026-07-07 14:01:00.777+00
99515	records.expandAllGroups	{"en": "Expand all groups", "he": "הרחב את כל הקבוצות", "ru": "Развернуть все группы"}	2026-07-05 21:59:27.167118+00	2026-07-07 14:01:00.954+00
99516	records.collapseAllGroups	{"en": "Collapse all groups", "he": "כווץ את כל הקבוצות", "ru": "Свернуть все группы"}	2026-07-05 21:59:27.170853+00	2026-07-07 14:01:00.957+00
101819	auto.trig.page_field_changed	{"en": "Page field changed", "he": "שדה עמוד השתנה", "ru": "Изменение поля страницы"}	2026-07-05 22:31:06.830956+00	2026-07-07 14:01:03.717+00
101820	auto.page	{"en": "Page", "he": "עמוד", "ru": "Страница"}	2026-07-05 22:31:06.845075+00	2026-07-07 14:01:03.72+00
101821	auto.pageField	{"en": "Page field", "he": "שדה עמוד", "ru": "Поле страницы"}	2026-07-05 22:31:06.849488+00	2026-07-07 14:01:03.723+00
101822	auto.sourceEntity	{"en": "Record", "he": "רשומה", "ru": "Запись"}	2026-07-05 22:31:06.853947+00	2026-07-07 14:01:03.726+00
101823	auto.sourcePage	{"en": "Page", "he": "עמוד", "ru": "Страница"}	2026-07-05 22:31:06.857979+00	2026-07-07 14:01:03.729+00
108396	cf.pageField	{"en": "Page field", "he": "שדה עמוד", "ru": "Поле страницы"}	2026-07-07 09:44:01.799552+00	2026-07-07 14:01:04.51+00
105876	records.customFilterOverlapNeedsTwo	{"en": "\\"Period overlap\\" requires exactly two date fields (start and end).", "he": "«חפיפת תקופה» מחייבת בדיוק שני שדות תאריך (התחלה וסוף).", "ru": "«Пересечение периода» требует ровно два поля даты (начало и конец)."}	2026-07-07 07:53:31.379144+00	2026-07-07 14:01:00.913+00
108399	cf.removeGroup	{"en": "Remove group", "he": "הסר קבוצה", "ru": "Удалить группу"}	2026-07-07 09:44:01.80891+00	2026-07-07 14:01:04.519+00
108400	cf.reorderError	{"en": "Failed to reorder", "he": "שגיאה בשינוי סדר", "ru": "Ошибка изменения порядка"}	2026-07-07 09:44:01.811854+00	2026-07-07 14:01:04.521+00
108404	cf.subtitle	{"en": "Flexible filters over any entity field. Each filter is a single button on the filter bar in the table, pivot and calendar.", "he": "מסננים גמישים על כל שדה של הישות. כל מסנן הוא כפתור אחד בסרגל המסננים בטבלה, בטבלת הציר וביומן.", "ru": "Гибкие фильтры по любым полям сущности. Каждый фильтр — одна кнопка на панели фильтров в таблице, сводной и календаре."}	2026-07-07 09:44:01.822399+00	2026-07-07 14:01:04.534+00
108405	cf.title	{"en": "Custom filters", "he": "מסננים מותאמים", "ru": "Кастомные фильтры"}	2026-07-07 09:44:01.825285+00	2026-07-07 14:01:04.541+00
108406	cf.topMatch	{"en": "Combine groups:", "he": "שילוב קבוצות:", "ru": "Группы объединяются:"}	2026-07-07 09:44:01.828733+00	2026-07-07 14:01:04.548+00
108407	cf.to	{"en": "to", "he": "עד", "ru": "до"}	2026-07-07 09:44:01.831329+00	2026-07-07 14:01:04.552+00
108408	cf.updated	{"en": "Filter updated", "he": "המסנן עודכן", "ru": "Фильтр обновлён"}	2026-07-07 09:44:01.834896+00	2026-07-07 14:01:04.555+00
104263	records.customFilterCombineOverlapHint	{"en": "The first selected field is the start, the last is the end of the row's interval.", "he": "השדה הראשון שנבחר הוא ההתחלה, האחרון הוא הסוף של מרווח השורה.", "ru": "Первое выбранное поле — начало, последнее — конец интервала строки."}	2026-07-07 07:44:03.915791+00	2026-07-07 14:01:00.807+00
104266	records.customFiltersSaved	{"en": "Custom filters saved", "he": "המסננים המותאמים נשמרו", "ru": "Пользовательские фильтры сохранены"}	2026-07-07 07:44:03.923901+00	2026-07-07 14:01:00.816+00
105874	records.customFilterInvalid	{"en": "Check your filters", "he": "בדוק את המסננים", "ru": "Проверьте фильтры"}	2026-07-07 07:53:31.372801+00	2026-07-07 14:01:00.82+00
105875	records.customFilterNeedsTwo	{"en": "Each filter must include at least two date fields.", "he": "כל מסנן חייב לכלול לפחות שני שדות תאריך.", "ru": "Каждый фильтр должен содержать минимум два поля даты."}	2026-07-07 07:53:31.376777+00	2026-07-07 14:01:00.823+00
105877	records.customFilterEmptyEndHint	{"en": "\\"AND\\" and \\"Period overlap\\" exclude rows with an empty second date (unfinished work). \\"OR\\" still matches them via the other field.", "he": "«וגם» ו«חפיפת תקופה» מחריגים שורות עם תאריך שני ריק (עבודה לא גמורה). «או» עדיין ימצא אותן דרך השדה השני.", "ru": "«И» и «Пересечение периода» исключают строки с пустой второй датой (незавершённые работы). «ИЛИ» всё равно найдёт их по другому полю."}	2026-07-07 07:53:31.382138+00	2026-07-07 14:01:00.916+00
108401	cf.srcEntity	{"en": "Field", "he": "שדה", "ru": "Поле"}	2026-07-07 09:44:01.814157+00	2026-07-07 14:01:04.525+00
104264	records.customFilterAdd	{"en": "Add filter", "he": "הוסף מסנן", "ru": "Добавить фильтр"}	2026-07-07 07:44:03.918666+00	2026-07-07 14:01:00.81+00
104265	records.customFiltersSave	{"en": "Save filters", "he": "שמור מסננים", "ru": "Сохранить фильтры"}	2026-07-07 07:44:03.921037+00	2026-07-07 14:01:00.813+00
108409	cf.updateError	{"en": "Failed to update", "he": "שגיאה בעדכון", "ru": "Ошибка обновления"}	2026-07-07 09:44:01.837314+00	2026-07-07 14:01:04.559+00
104256	records.customFiltersNoFields	{"en": "No eligible fields. You need date fields marked as filterable.", "he": "אין שדות מתאימים. נדרשים שדות תאריך המסומנים כניתנים לסינון.", "ru": "Нет подходящих полей. Нужны поля даты, отмеченные как «участвует в фильтре»."}	2026-07-07 07:44:03.889823+00	2026-07-07 14:01:00.784+00
104257	records.customFilterLabel	{"en": "Filter name", "he": "שם המסנן", "ru": "Название фильтра"}	2026-07-07 07:44:03.895794+00	2026-07-07 14:01:00.788+00
104258	records.customFilterFields	{"en": "Date fields", "he": "שדות תאריך", "ru": "Поля даты"}	2026-07-07 07:44:03.899136+00	2026-07-07 14:01:00.79+00
104259	records.customFilterCombine	{"en": "How to combine fields", "he": "כיצד לשלב שדות", "ru": "Как объединять поля"}	2026-07-07 07:44:03.901853+00	2026-07-07 14:01:00.794+00
104260	records.customFilterCombineOr	{"en": "Any field in period (OR)", "he": "כל שדה בתקופה (או)", "ru": "Любое поле в периоде (ИЛИ)"}	2026-07-07 07:44:03.90481+00	2026-07-07 14:01:00.797+00
104261	records.customFilterCombineAnd	{"en": "All fields in period (AND)", "he": "כל השדות בתקופה (וגם)", "ru": "Все поля в периоде (И)"}	2026-07-07 07:44:03.910053+00	2026-07-07 14:01:00.801+00
104262	records.customFilterCombineOverlap	{"en": "Period (start…end) overlaps", "he": "התקופה (התחלה…סוף) חופפת", "ru": "Период (начало…конец) пересекается"}	2026-07-07 07:44:03.913173+00	2026-07-07 14:01:00.804+00
108402	cf.srcPage	{"en": "Page", "he": "עמוד", "ru": "Страница"}	2026-07-07 09:44:01.81698+00	2026-07-07 14:01:04.527+00
108403	cf.static	{"en": "Value", "he": "ערך", "ru": "Значение"}	2026-07-07 09:44:01.819314+00	2026-07-07 14:01:04.531+00
108410	cf.valuePlaceholder	{"en": "value", "he": "ערך", "ru": "значение"}	2026-07-07 09:44:01.840686+00	2026-07-07 14:01:04.562+00
108358	cf.addInput	{"en": "Add input", "he": "הוסף קלט", "ru": "Добавить ввод"}	2026-07-07 09:44:01.579761+00	2026-07-07 14:01:04.38+00
108360	cf.back	{"en": "Back to entities", "he": "חזרה לישויות", "ru": "К сущностям"}	2026-07-07 09:44:01.585399+00	2026-07-07 14:01:04.393+00
108361	cf.colActive	{"en": "Active", "he": "פעיל", "ru": "Активен"}	2026-07-07 09:44:01.587982+00	2026-07-07 14:01:04.396+00
108362	cf.colConditions	{"en": "Conditions", "he": "תנאים", "ru": "Условия"}	2026-07-07 09:44:01.591265+00	2026-07-07 14:01:04.399+00
108363	cf.colInputs	{"en": "Inputs", "he": "קלטים", "ru": "Ввод"}	2026-07-07 09:44:01.594252+00	2026-07-07 14:01:04.403+00
108365	cf.condAll	{"en": "all conditions (AND)", "he": "כל התנאים (וגם)", "ru": "все условия (И)"}	2026-07-07 09:44:01.600668+00	2026-07-07 14:01:04.409+00
108366	cf.condAny	{"en": "any condition (OR)", "he": "תנאי כלשהו (או)", "ru": "любое условие (ИЛИ)"}	2026-07-07 09:44:01.603787+00	2026-07-07 14:01:04.412+00
108367	cf.condCount	{"en": "conditions: {n}", "he": "תנאים: {n}", "ru": "условий: {n}"}	2026-07-07 09:44:01.606399+00	2026-07-07 14:01:04.416+00
108368	cf.created	{"en": "Filter created", "he": "המסנן נוצר", "ru": "Фильтр создан"}	2026-07-07 09:44:01.609453+00	2026-07-07 14:01:04.419+00
108369	cf.createError	{"en": "Failed to create", "he": "שגיאה ביצירה", "ru": "Ошибка создания"}	2026-07-07 09:44:01.61207+00	2026-07-07 14:01:04.423+00
108370	cf.deleteDesc	{"en": "This action cannot be undone.", "he": "לא ניתן לבטל פעולה זו.", "ru": "Действие необратимо."}	2026-07-07 09:44:01.615211+00	2026-07-07 14:01:04.426+00
108371	cf.deleted	{"en": "Filter deleted", "he": "המסנן נמחק", "ru": "Фильтр удалён"}	2026-07-07 09:44:01.618093+00	2026-07-07 14:01:04.43+00
108372	cf.deleteError	{"en": "Failed to delete", "he": "שגיאה במחיקה", "ru": "Ошибка удаления"}	2026-07-07 09:44:01.62165+00	2026-07-07 14:01:04.432+00
108373	cf.deleteTitle	{"en": "Delete filter?", "he": "למחוק מסנן?", "ru": "Удалить фильтр?"}	2026-07-07 09:44:01.624362+00	2026-07-07 14:01:04.436+00
108374	cf.dialogDesc	{"en": "Build the condition from groups. Groups combine by the top-level logic; conditions within a group by the group's logic: (A AND B) OR (C AND D).", "he": "בנה את התנאי מקבוצות. הקבוצות משתלבות לפי הלוגיקה העליונה, והתנאים בתוך קבוצה לפי לוגיקת הקבוצה: (A וגם B) או (C וגם D).", "ru": "Соберите условие из групп. Группы объединяются логикой верхнего уровня, условия внутри группы — логикой группы: (A И B) ИЛИ (C И D)."}	2026-07-07 09:44:01.627605+00	2026-07-07 14:01:04.439+00
108375	cf.edit	{"en": "Edit filter", "he": "ערוך מסנן", "ru": "Редактировать фильтр"}	2026-07-07 09:44:01.630211+00	2026-07-07 14:01:04.443+00
108376	cf.empty	{"en": "No filters yet.", "he": "אין מסננים עדיין.", "ru": "Фильтров пока нет."}	2026-07-07 09:44:01.633077+00	2026-07-07 14:01:04.446+00
108377	cf.fieldMissing	{"en": "Select a field", "he": "בחר שדה", "ru": "Выберите поле"}	2026-07-07 09:44:01.635486+00	2026-07-07 14:01:04.449+00
108378	cf.field	{"en": "Field", "he": "שדה", "ru": "Поле"}	2026-07-07 09:44:01.638593+00	2026-07-07 14:01:04.453+00
108379	cf.fromInput	{"en": "User input", "he": "קלט משתמש", "ru": "Ввод пользователя"}	2026-07-07 09:44:01.641141+00	2026-07-07 14:01:04.456+00
108380	cf.from	{"en": "from", "he": "מ־", "ru": "от"}	2026-07-07 09:44:01.752565+00	2026-07-07 14:01:04.46+00
108382	cf.inputLabel	{"en": "Label (e.g. \\"Period\\")", "he": "תווית (לדוגמה \\"תקופה\\")", "ru": "Подпись (напр. «Период»)"}	2026-07-07 09:44:01.758826+00	2026-07-07 14:01:04.466+00
108383	cf.inputMissing	{"en": "Select a user input for the condition", "he": "בחר קלט משתמש לתנאי", "ru": "Выберите пользовательский ввод для условия"}	2026-07-07 09:44:01.761446+00	2026-07-07 14:01:04.47+00
108384	cf.inputsHint	{"en": "Values the user enters when applying the filter. One input can be used in several conditions (e.g. one period for two dates).", "he": "ערכים שהמשתמש מזין בעת החלת המסנן. ניתן להשתמש בקלט אחד בכמה תנאים (למשל תקופה אחת לשני תאריכים).", "ru": "Значения, которые пользователь вводит при применении фильтра. Один ввод можно использовать в нескольких условиях (например, один период на две даты)."}	2026-07-07 09:44:01.764587+00	2026-07-07 14:01:04.472+00
108385	cf.inputs	{"en": "User inputs", "he": "קלט משתמש", "ru": "Пользовательский ввод"}	2026-07-07 09:44:01.767165+00	2026-07-07 14:01:04.476+00
108386	cf.matchAll	{"en": "all groups (AND)", "he": "כל הקבוצות (וגם)", "ru": "все группы (И)"}	2026-07-07 09:44:01.770303+00	2026-07-07 14:01:04.479+00
108387	cf.matchAny	{"en": "any group (OR)", "he": "קבוצה כלשהי (או)", "ru": "любая группа (ИЛИ)"}	2026-07-07 09:44:01.772851+00	2026-07-07 14:01:04.482+00
108388	cf.nameLabel	{"en": "Name", "he": "שם", "ru": "Название"}	2026-07-07 09:44:01.776019+00	2026-07-07 14:01:04.485+00
108389	cf.nameRequired	{"en": "Enter a name", "he": "הזן שם", "ru": "Введите название"}	2026-07-07 09:44:01.778669+00	2026-07-07 14:01:04.488+00
108390	cf.new	{"en": "New filter", "he": "מסנן חדש", "ru": "Новый фильтр"}	2026-07-07 09:44:01.781508+00	2026-07-07 14:01:04.492+00
108391	cf.noConditions	{"en": "Add at least one condition", "he": "הוסף לפחות תנאי אחד", "ru": "Добавьте хотя бы одно условие"}	2026-07-07 09:44:01.783941+00	2026-07-07 14:01:04.495+00
108355	cf.activeLabel	{"en": "Active", "he": "פעיל", "ru": "Активен"}	2026-07-07 09:44:01.568015+00	2026-07-07 14:01:04.371+00
108356	cf.addCondition	{"en": "Add condition", "he": "הוסף תנאי", "ru": "Добавить условие"}	2026-07-07 09:44:01.571207+00	2026-07-07 14:01:04.374+00
108357	cf.addGroup	{"en": "Add group (OR)", "he": "הוסף קבוצה (או)", "ru": "Добавить группу (ИЛИ)"}	2026-07-07 09:44:01.574398+00	2026-07-07 14:01:04.377+00
108359	cf.add	{"en": "Add filter", "he": "הוסף מסנן", "ru": "Добавить фильтр"}	2026-07-07 09:44:01.582306+00	2026-07-07 14:01:04.389+00
108364	cf.colName	{"en": "Name", "he": "שם", "ru": "Название"}	2026-07-07 09:44:01.597515+00	2026-07-07 14:01:04.406+00
108381	cf.group	{"en": "Group", "he": "קבוצה", "ru": "Группа"}	2026-07-07 09:44:01.755135+00	2026-07-07 14:01:04.463+00
111688	import.file	{"en": "File", "he": "קובץ", "ru": "Файл"}	2026-07-07 12:09:45.060704+00	2026-07-07 14:01:04.064+00
111689	import.target	{"en": "Target", "he": "יעד", "ru": "Цель"}	2026-07-07 12:09:45.065025+00	2026-07-07 14:01:04.068+00
110005	import.filesCount	{"en": "files", "he": "קבצים", "ru": "файлов"}	2026-07-07 11:59:53.782042+00	2026-07-07 14:01:04.104+00
110006	import.kindEntity	{"en": "Entity records", "he": "רשומות ישות", "ru": "Записи сущности"}	2026-07-07 11:59:53.784941+00	2026-07-07 14:01:04.108+00
110009	import.pickHostField	{"en": "Record lookup field…", "he": "שדה איתור רשומה…", "ru": "Поле поиска записи…"}	2026-07-07 11:59:53.792026+00	2026-07-07 14:01:04.117+00
110010	import.hostkey	{"en": "🔑 Record key", "he": "🔑 מפתח רשומה", "ru": "🔑 Ключ записи"}	2026-07-07 11:59:53.795019+00	2026-07-07 14:01:04.121+00
110011	import.needEntity	{"en": "Choose an entity", "he": "בחר ישות", "ru": "Выберите сущность"}	2026-07-07 11:59:53.797512+00	2026-07-07 14:01:04.123+00
110012	import.needPage	{"en": "Choose a page", "he": "בחר עמוד", "ru": "Выберите страницу"}	2026-07-07 11:59:53.805135+00	2026-07-07 14:01:04.127+00
110013	import.needHostCol	{"en": "Map the record-key column", "he": "מפה את עמודת מפתח הרשומה", "ru": "Укажите колонку с ключом записи"}	2026-07-07 11:59:53.808289+00	2026-07-07 14:01:04.13+00
110014	import.needHostField	{"en": "Choose the record lookup field", "he": "בחר את שדה איתור הרשומה", "ru": "Выберите поле поиска записи"}	2026-07-07 11:59:53.811992+00	2026-07-07 14:01:04.133+00
110015	import.commitRolledBack	{"en": "Import cancelled (errors found)", "he": "הייבוא בוטל (נמצאו שגיאות)", "ru": "Импорт отменён (есть ошибки)"}	2026-07-07 11:59:53.814723+00	2026-07-07 14:01:04.136+00
110016	import.hasErrors	{"en": "Errors found — fix before importing", "he": "נמצאו שגיאות — תקנו לפני הייבוא", "ru": "Найдены ошибки — исправьте перед импортом"}	2026-07-07 11:59:53.81782+00	2026-07-07 14:01:04.273+00
110017	import.configureAll	{"en": "Configure all files to continue", "he": "הגדירו את כל הקבצים כדי להמשיך", "ru": "Настройте все файлы, чтобы продолжить"}	2026-07-07 11:59:53.82022+00	2026-07-07 14:01:04.276+00
87040	records.pageDefaultFilterHint	{"en": "Set the filters you want in the bar above the table (in normal mode), then save them here. They will be applied automatically when the page opens, but the user can change or clear them. A default filter can never reveal rows hidden by the view's filter.", "he": "הגדירו את המסננים הרצויים בסרגל שמעל הטבלה (במצב רגיל), ואז שמרו אותם כאן. הם יוחלו אוטומטית בעת פתיחת העמוד, אך המשתמש יוכל לשנות או לנקות אותם. מסנן ברירת מחדל לעולם אינו יכול לחשוף שורות המוסתרות על ידי מסנן התצוגה.", "ru": "Выставьте нужные фильтры в панели над таблицей (в обычном режиме), затем сохраните их здесь. При открытии страницы они применятся автоматически, но пользователь сможет их изменить или очистить. Фильтр по умолчанию не может показать строки, скрытые фильтром вида."}	2026-07-01 14:44:23.711186+00	2026-07-07 14:01:00.749+00
104255	records.customFiltersHint	{"en": "Combine several date fields into one filter-bar chip. For example, \\"Work in period\\" over two dates returns rows where either date falls in the picked period.", "he": "שלב כמה שדות תאריך למסנן אחד בסרגל. לדוגמה, «עבודות בתקופה» על שני תאריכים יחזיר שורות שבהן אחד התאריכים נופל בתקופה שנבחרה.", "ru": "Объедините несколько полей даты в один фильтр на панели. Например «Работы за период» по двум датам вернёт строки, где в выбранный период попадает любая из дат."}	2026-07-07 07:44:03.886742+00	2026-07-07 14:01:00.781+00
110003	import.subtitleBatch	{"en": "Upload one or more files at once — the system orders them by relations and imports them in one validated pass (all-or-nothing per batch)", "he": "העלו קובץ אחד או יותר בבת אחת — המערכת מסדרת אותם לפי קשרים ומייבאת בפעולה מאומתת אחת (הכול או כלום עבור האצווה)", "ru": "Загрузите один или несколько файлов сразу — система расставит их по связям и импортирует одной проверенной операцией (всё или ничего в рамках пакета)"}	2026-07-07 11:59:53.775234+00	2026-07-07 14:01:04.077+00
110004	import.uploadFiles	{"en": "Upload ready files", "he": "העלה קבצים מוכנים", "ru": "Загрузить готовые файлы"}	2026-07-07 11:59:53.779801+00	2026-07-07 14:01:04.081+00
113383	import.addCard	{"en": "Add file", "he": "הוסף קובץ", "ru": "Добавить файл"}	2026-07-07 14:01:04.084724+00	2026-07-07 14:01:04.084724+00
113384	import.noFileYet	{"en": "No file attached", "he": "לא צורף קובץ", "ru": "Файл не загружен"}	2026-07-07 14:01:04.088232+00	2026-07-07 14:01:04.088232+00
113385	import.attachFile	{"en": "Upload filled file", "he": "העלה קובץ ממולא", "ru": "Загрузить заполненный файл"}	2026-07-07 14:01:04.09086+00	2026-07-07 14:01:04.09086+00
113386	import.replaceFile	{"en": "Replace file", "he": "החלף קובץ", "ru": "Заменить файл"}	2026-07-07 14:01:04.095784+00	2026-07-07 14:01:04.095784+00
113387	import.needFile	{"en": "Upload the filled file", "he": "העלו את הקובץ הממולא", "ru": "Загрузите заполненный файл"}	2026-07-07 14:01:04.098929+00	2026-07-07 14:01:04.098929+00
110007	import.kindPage	{"en": "Page values", "he": "ערכי עמוד", "ru": "Значения страницы"}	2026-07-07 11:59:53.787057+00	2026-07-07 14:01:04.111+00
110008	import.pickPage	{"en": "Mirror page…", "he": "עמוד מראה…", "ru": "Зеркальная страница…"}	2026-07-07 11:59:53.78998+00	2026-07-07 14:01:04.115+00
\.


--
-- Data for Name: user_roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_roles (user_id, role_id, created_at) FROM stdin;
2	2	2026-06-09 16:08:04.709103+00
20	2	2026-06-09 16:08:04.709103+00
1	1	2026-06-09 16:08:04.709103+00
3	5	2026-06-09 16:08:04.709103+00
5	12	2026-06-09 16:08:04.709103+00
21	1	2026-06-09 16:27:41.702961+00
21	2	2026-06-09 16:27:41.702961+00
22	11	2026-06-10 15:23:47.937351+00
23	13	2026-06-14 06:00:29.303549+00
24	4	2026-06-14 14:34:02.155523+00
14	4	2026-06-14 14:34:12.751025+00
15	4	2026-06-14 14:34:23.599071+00
25	4	2026-06-14 14:34:56.851532+00
26	4	2026-06-14 14:35:24.835278+00
27	4	2026-06-14 14:36:02.7632+00
28	4	2026-06-14 14:36:30.072953+00
29	4	2026-06-14 14:37:15.174003+00
30	4	2026-06-14 14:37:48.378893+00
31	4	2026-06-14 14:38:31.689681+00
32	4	2026-06-14 14:39:16.637027+00
33	4	2026-06-14 14:39:55.060122+00
34	4	2026-06-14 14:40:25.236751+00
35	4	2026-06-14 14:40:50.579393+00
36	13	2026-06-14 14:41:42.589184+00
37	13	2026-06-14 14:42:09.7557+00
38	13	2026-06-14 14:42:36.982779+00
39	13	2026-06-14 14:43:32.873115+00
40	13	2026-06-14 14:44:24.291102+00
41	13	2026-06-14 14:44:57.535158+00
42	13	2026-06-14 14:45:30.480279+00
43	11	2026-06-30 14:22:37.325054+00
45	11	2026-07-06 19:37:24.053673+00
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, email, password_hash, first_name, last_name, role_id, language, direction, start_page_id, is_active, created_at, updated_at) FROM stdin;
23	kiril@davidov-k.co.il	$2b$10$W7CV3gcvlVx0pspvrsLHNuNB01Zo4Eyk2XsJItMHvuVUt3oNMaZji	Кирил		13	ru	ltr	\N	t	2026-06-14 06:00:29.303549+00	2026-06-14 06:00:29.303549+00
24	mahdi@erp.local	$2b$10$yekAhSnce5TPCravMXVvS.YeBjOr7fgYy.YPYSTcOIcOGiiuMA2z6	Mahdi		4	he	rtl	\N	t	2026-06-14 14:34:02.155523+00	2026-06-14 14:34:02.155523+00
15	suleiman@erp.local	$2b$10$rYOOH6u41nS22Af2jfinjepm5nhDLkW9sujg9PE/E3pxDm/iXIB02	Suleiman		4	he	rtl	\N	t	2026-06-08 20:47:03.868835+00	2026-06-14 14:34:23.599+00
25	subhi@erp.local	$2b$10$fvSBMR6YYzDbHmCL4cpKtewxgmdhFVCch3KVNXRvTwNQL9z0dMMK2	Subhi		4	he	rtl	\N	t	2026-06-14 14:34:56.851532+00	2026-06-14 14:34:56.851532+00
26	valera@erp.local	$2b$10$i1DWt6nWgbFVSiVx3idh4utxlhBlSw2VLD7ARAjdvxyHzaNfOwzXS	Valera		4	ru	ltr	\N	t	2026-06-14 14:35:24.835278+00	2026-06-14 14:35:24.835278+00
27	kablan@erp.local	$2b$10$SvEsaCh6PMNVflfpLZ3GJ..LI/dZr04nV7MbkPYQe68tzdjgtOrAS	Каблан		4	he	rtl	\N	t	2026-06-14 14:36:02.7632+00	2026-06-14 14:36:02.7632+00
28	sair@erp.local	$2b$10$kPaTglZ8zCvFcrW/C3.xLe02QIiQjKPfEPKv98voWA7PCNhz4I3CS	Sair		4	he	rtl	\N	t	2026-06-14 14:36:30.072953+00	2026-06-14 14:36:30.072953+00
29	olegshemromen@erp.local	$2b$10$yZSIf9r82a/HHOKLMPuCI.veCojFfXxI251pGHQDNJXIWbmoMHPJK	Олег Шем Ронен		4	ru	ltr	\N	t	2026-06-14 14:37:15.174003+00	2026-06-14 14:37:15.174003+00
30	oleggolshtein@erp.local	$2b$10$9rhKiIpeZn5QUzkUoxoZceU9c8idgo0FyYI/t4UwCoUx5h1xXyik2	Олег Гольштейн		4	ru	ltr	\N	t	2026-06-14 14:37:48.378893+00	2026-06-14 14:37:48.378893+00
31	mashbak@erp.local	$2b$10$gQMZo3fsgcIGGypUDJ4QSOg921j8xb7LawwMqecp1vsvzZBtna4tG	המשבק		4	he	rtl	\N	t	2026-06-14 14:38:31.689681+00	2026-06-14 14:38:31.689681+00
32	iashrik@erp.local	$2b$10$aqSm.0xukyy6LLiEO9MhNOHsclWc8JecTN28q4QoDTnhNTlrPHF4K	הישריק סבכות		4	he	rtl	\N	t	2026-06-14 14:39:16.637027+00	2026-06-14 14:39:16.637027+00
14	hamada@erp.local	$2b$10$rYOOH6u41nS22Af2jfinjepm5nhDLkW9sujg9PE/E3pxDm/iXIB02	Hamada		4	he	rtl	\N	t	2026-06-08 20:47:03.868835+00	2026-06-22 20:07:03.13+00
43	test2@gmail.com	$2b$10$mMxPQc2huWjYaM/JyG8GDuLOMIt/dNZAKqAPVoAMBgiFySWOwT5ce	Тест 2	ПРоба	11	he	rtl	\N	t	2026-06-30 14:22:37.325054+00	2026-06-30 14:22:37.325054+00
33	mahsan@erp.local	$2b$10$NJcn7qcl8ZRzpN5qAfZbnevpHDTq2iRBTfAtKWkRfOHi8i8kZrTIW	מחסן אורנית		4	he	rtl	\N	t	2026-06-14 14:39:55.060122+00	2026-06-14 14:39:55.060122+00
2	baruch.sd.davidov@gmail.com	$2b$10$NWPhU6bk.Dv6EaSNrTKqmusVW3IjTyKKuvpxDAanAE3xRKKnmQy4e	ברוך	רינה	2	ru	ltr	\N	t	2026-06-04 18:00:13.778853+00	2026-06-09 15:22:34.788+00
20	evgeni.sd.davidov@gmail.com	$2b$10$ICNSJLI01.F5n1G7VuszbeToJdTRysCpkz69FeLWm2caCQ.288OHG	יבגניי	ארינה	2	ru	ltr	\N	t	2026-06-09 15:25:01.59037+00	2026-06-09 15:25:01.59037+00
34	ahmad@erp.local	$2b$10$rI9sMbvE6b4TCftWr4qPBe/v4VaorLM0.GZVfLhqfgwjUYwm3kx9C	AHMAD		4	he	rtl	\N	t	2026-06-14 14:40:25.236751+00	2026-06-14 14:40:25.236751+00
3	heshbonot.davidov@gmail.com	$2b$10$NWPhU6bk.Dv6EaSNrTKqmusVW3IjTyKKuvpxDAanAE3xRKKnmQy4e	Alena	Davidov	5	ru	ltr	\N	t	2026-06-04 18:00:13.778853+00	2026-06-09 15:33:51.17+00
5	logist.davidov@gmail.com	$2b$10$u4dYblGkEoxQ67HgAC6cceeo92Pt41ljhesdKKOIh2XDParQEg5/q	Логист		12	ru	ltr	\N	t	2026-06-05 05:39:35.942054+00	2026-06-09 15:34:51.662+00
21	vladimirdavidov7@gmail.com	$2b$10$/pqUMQSGzXz6NaHG7ivsNuqzZVyIZfZ0OEK4rdCqzKjBNBo4kUvdi	ולדימיר		1	ru	ltr	\N	t	2026-06-09 15:30:12.137626+00	2026-06-09 16:27:41.704+00
22	test@gmail.com	$2b$10$JhZ9oRpc7mTv4A.oqFpyYu9NwO/GhFgzyM8csOLwj12y45czma1KC	Тест	Tsss	11	he	ltr	\N	t	2026-06-10 15:23:47.937351+00	2026-06-10 15:23:47.937351+00
35	polina@erp.local	$2b$10$epBt4/w/fiWMCyAsz5KrmOvqGKkvz0.uwSo0HYEGnw5UkuiaZ7cHS	polina		4	ru	ltr	\N	t	2026-06-14 14:40:50.579393+00	2026-06-14 14:40:50.579393+00
36	rinat@erp.local	$2b$10$VKCU3E03jRoarxQ9EMz1UeDE381wPtV2c/p41.M7r93QBGyFACbaO	Ринат		13	ru	ltr	\N	t	2026-06-14 14:41:42.589184+00	2026-06-14 14:41:42.589184+00
37	michael@erp.local	$2b$10$.Z8LTzvmjpQaPyug5fnM0OtHI59H2Js.URbtbcJWxyhYWAvv0mOge	Михаил		13	ru	ltr	\N	t	2026-06-14 14:42:09.7557+00	2026-06-14 14:42:09.7557+00
38	anatoliy@erp.local	$2b$10$a3x/buXcRdxGQcnNuyXeqeRs6wrATHffIKbhmuPgCUtnVnL/wbcwy	Анатолий		13	ru	ltr	\N	t	2026-06-14 14:42:36.982779+00	2026-06-14 14:42:36.982779+00
39	hamada.arch@erp.local	$2b$10$hcio/cMA1Js8IiA40irrB.wvYG7aHwnbfguXi6awYdzLGFOTUIaS6	Хамада		13	he	rtl	\N	t	2026-06-14 14:43:32.873115+00	2026-06-14 14:43:32.873115+00
40	mahdi.arch@erp.local	$2b$10$YItLufmx9BO/3fjXmBtHZe.dJVeLgbKqngd5LauGrC8FowYpXr26.	Махди		13	he	rtl	\N	t	2026-06-14 14:44:24.291102+00	2026-06-14 14:44:24.291102+00
41	abdalla@erp.local	$2b$10$V2VTLy5yqARcjheUgyAr/eX3N57Ju21NX7JKudkkAxGENjoJw8Fh2	Абдалла		13	he	rtl	\N	t	2026-06-14 14:44:57.535158+00	2026-06-14 14:44:57.535158+00
42	evgeni@erp.local	$2b$10$sxFx3zRqCh5/TKrHUmmgquWbcRrQWwss.LszACE4QHpVWr3ccDQhu	יבגניי		13	ru	ltr	\N	t	2026-06-14 14:45:30.480279+00	2026-06-14 14:45:30.480279+00
45	electra@erp.local	$2b$10$Km1C6mzxhTXpwIKk7N31GuwGsYdmXkagZQ8ivrjpbMx4IN5e/UefC	Electra	Ltd	11	he	rtl	\N	t	2026-07-06 19:37:24.053673+00	2026-07-06 19:37:24.053673+00
1	admin@erp.local	$2b$10$nijrcV0i60MOjZwALOt/M.rHdpamtiBDKlp47EfZRQbN.h7a1eCki	Alexey	Suzdaltsev	1	ru	ltr	\N	t	2026-06-04 18:00:13.778853+00	2026-07-07 07:10:07.892+00
\.


--
-- Data for Name: views; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.views (id, entity_id, view_key, name_json, config_json, is_default, sort_order, is_active, created_at, updated_at, visible_role_ids_json) FROM stdin;
\.


--
-- Name: audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.audit_log_id_seq', 610, true);


--
-- Name: column_groups_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.column_groups_id_seq', 5, true);


--
-- Name: custom_filters_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.custom_filters_id_seq', 1, true);


--
-- Name: dashboard_widgets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.dashboard_widgets_id_seq', 47, true);


--
-- Name: deleted_files_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.deleted_files_id_seq', 1, true);


--
-- Name: entities_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.entities_id_seq', 76, true);


--
-- Name: entity_automation_runs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.entity_automation_runs_id_seq', 150, true);


--
-- Name: entity_automations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.entity_automations_id_seq', 9, true);


--
-- Name: entity_fields_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.entity_fields_id_seq', 215, true);


--
-- Name: entity_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.entity_records_id_seq', 163, true);


--
-- Name: entity_statuses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.entity_statuses_id_seq', 67, true);


--
-- Name: entity_transitions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.entity_transitions_id_seq', 35, true);


--
-- Name: google_drive_connection_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.google_drive_connection_id_seq', 1, false);


--
-- Name: google_drive_folders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.google_drive_folders_id_seq', 4, true);


--
-- Name: guest_links_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.guest_links_id_seq', 4, true);


--
-- Name: local_folders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.local_folders_id_seq', 1, true);


--
-- Name: login_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.login_history_id_seq', 199, true);


--
-- Name: modules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.modules_id_seq', 3, true);


--
-- Name: page_fields_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.page_fields_id_seq', 54, true);


--
-- Name: page_record_values_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.page_record_values_id_seq', 11, true);


--
-- Name: pages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.pages_id_seq', 82, true);


--
-- Name: record_links_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.record_links_id_seq', 91, true);


--
-- Name: relations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.relations_id_seq', 34, true);


--
-- Name: roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.roles_id_seq', 14, true);


--
-- Name: system_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.system_events_id_seq', 525, true);


--
-- Name: translations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.translations_id_seq', 113486, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 45, true);


--
-- Name: views_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.views_id_seq', 16, true);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: column_groups column_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.column_groups
    ADD CONSTRAINT column_groups_pkey PRIMARY KEY (id);


--
-- Name: custom_filters custom_filters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.custom_filters
    ADD CONSTRAINT custom_filters_pkey PRIMARY KEY (id);


--
-- Name: dashboard_widgets dashboard_widgets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dashboard_widgets
    ADD CONSTRAINT dashboard_widgets_pkey PRIMARY KEY (id);


--
-- Name: deleted_files deleted_files_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deleted_files
    ADD CONSTRAINT deleted_files_pkey PRIMARY KEY (id);


--
-- Name: entities entities_entity_key_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_entity_key_unique UNIQUE (entity_key);


--
-- Name: entities entities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_pkey PRIMARY KEY (id);


--
-- Name: entity_automation_runs entity_automation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_automation_runs
    ADD CONSTRAINT entity_automation_runs_pkey PRIMARY KEY (id);


--
-- Name: entity_automations entity_automations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_automations
    ADD CONSTRAINT entity_automations_pkey PRIMARY KEY (id);


--
-- Name: entity_fields entity_field_key_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_fields
    ADD CONSTRAINT entity_field_key_unique UNIQUE (entity_id, field_key);


--
-- Name: entity_fields entity_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_fields
    ADD CONSTRAINT entity_fields_pkey PRIMARY KEY (id);


--
-- Name: entity_records entity_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_records
    ADD CONSTRAINT entity_records_pkey PRIMARY KEY (id);


--
-- Name: entity_statuses entity_status_key_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_statuses
    ADD CONSTRAINT entity_status_key_unique UNIQUE (entity_id, status_key);


--
-- Name: entity_statuses entity_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_statuses
    ADD CONSTRAINT entity_statuses_pkey PRIMARY KEY (id);


--
-- Name: entity_transitions entity_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_transitions
    ADD CONSTRAINT entity_transitions_pkey PRIMARY KEY (id);


--
-- Name: google_drive_connection google_drive_connection_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.google_drive_connection
    ADD CONSTRAINT google_drive_connection_pkey PRIMARY KEY (id);


--
-- Name: google_drive_folders google_drive_folders_drive_folder_id_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.google_drive_folders
    ADD CONSTRAINT google_drive_folders_drive_folder_id_unique UNIQUE (drive_folder_id);


--
-- Name: google_drive_folders google_drive_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.google_drive_folders
    ADD CONSTRAINT google_drive_folders_pkey PRIMARY KEY (id);


--
-- Name: guest_links guest_links_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.guest_links
    ADD CONSTRAINT guest_links_pkey PRIMARY KEY (id);


--
-- Name: guest_links guest_links_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.guest_links
    ADD CONSTRAINT guest_links_token_hash_unique UNIQUE (token_hash);


--
-- Name: local_folders local_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.local_folders
    ADD CONSTRAINT local_folders_pkey PRIMARY KEY (id);


--
-- Name: local_folders local_folders_storage_dir_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.local_folders
    ADD CONSTRAINT local_folders_storage_dir_unique UNIQUE (storage_dir);


--
-- Name: login_history login_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.login_history
    ADD CONSTRAINT login_history_pkey PRIMARY KEY (id);


--
-- Name: modules modules_module_key_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_module_key_unique UNIQUE (module_key);


--
-- Name: modules modules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_pkey PRIMARY KEY (id);


--
-- Name: page_fields page_field_key_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.page_fields
    ADD CONSTRAINT page_field_key_unique UNIQUE (page_id, field_key);


--
-- Name: page_fields page_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.page_fields
    ADD CONSTRAINT page_fields_pkey PRIMARY KEY (id);


--
-- Name: page_record_values page_record_value_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.page_record_values
    ADD CONSTRAINT page_record_value_unique UNIQUE (page_id, record_id);


--
-- Name: page_record_values page_record_values_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.page_record_values
    ADD CONSTRAINT page_record_values_pkey PRIMARY KEY (id);


--
-- Name: pages pages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_pkey PRIMARY KEY (id);


--
-- Name: record_links record_link_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.record_links
    ADD CONSTRAINT record_link_unique UNIQUE (relation_id, source_record_id, target_record_id);


--
-- Name: record_links record_links_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.record_links
    ADD CONSTRAINT record_links_pkey PRIMARY KEY (id);


--
-- Name: relations relation_source_key_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.relations
    ADD CONSTRAINT relation_source_key_unique UNIQUE (source_entity_id, relation_key);


--
-- Name: relations relations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.relations
    ADD CONSTRAINT relations_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: system_events system_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_events
    ADD CONSTRAINT system_events_pkey PRIMARY KEY (id);


--
-- Name: translations translations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.translations
    ADD CONSTRAINT translations_pkey PRIMARY KEY (id);


--
-- Name: translations translations_translation_key_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.translations
    ADD CONSTRAINT translations_translation_key_unique UNIQUE (translation_key);


--
-- Name: user_roles user_roles_user_id_role_id_pk; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_id_pk PRIMARY KEY (user_id, role_id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: views view_entity_key_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.views
    ADD CONSTRAINT view_entity_key_unique UNIQUE (entity_id, view_key);


--
-- Name: views views_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.views
    ADD CONSTRAINT views_pkey PRIMARY KEY (id);


--
-- Name: custom_filter_entity_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX custom_filter_entity_idx ON public.custom_filters USING btree (entity_id);


--
-- Name: entity_automation_entity_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX entity_automation_entity_idx ON public.entity_automations USING btree (entity_id);


--
-- Name: entity_automation_run_automation_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX entity_automation_run_automation_idx ON public.entity_automation_runs USING btree (automation_id);


--
-- Name: entity_automation_run_dedupe_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX entity_automation_run_dedupe_unique ON public.entity_automation_runs USING btree (automation_id, record_id, dedupe_key) WHERE (dedupe_key IS NOT NULL);


--
-- Name: entity_automation_run_entity_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX entity_automation_run_entity_idx ON public.entity_automation_runs USING btree (entity_id);


--
-- Name: entity_status_one_default; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX entity_status_one_default ON public.entity_statuses USING btree (entity_id) WHERE (is_default = true);


--
-- Name: entity_transition_entity_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX entity_transition_entity_idx ON public.entity_transitions USING btree (entity_id);


--
-- Name: entity_transition_from_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX entity_transition_from_idx ON public.entity_transitions USING btree (from_status_id);


--
-- Name: entity_transition_specific_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX entity_transition_specific_unique ON public.entity_transitions USING btree (entity_id, from_status_id, to_status_id) WHERE (from_status_id IS NOT NULL);


--
-- Name: entity_transition_wildcard_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX entity_transition_wildcard_unique ON public.entity_transitions USING btree (entity_id, to_status_id) WHERE (from_status_id IS NULL);


--
-- Name: local_folders_single_default_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX local_folders_single_default_idx ON public.local_folders USING btree (is_default) WHERE (is_default = true);


--
-- Name: record_link_source_one; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX record_link_source_one ON public.record_links USING btree (relation_id, source_record_id) WHERE (relation_type = ANY (ARRAY['one_to_one'::text, 'many_to_one'::text]));


--
-- Name: record_link_target_one; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX record_link_target_one ON public.record_links USING btree (relation_id, target_record_id) WHERE (relation_type = ANY (ARRAY['one_to_one'::text, 'one_to_many'::text]));


--
-- Name: view_one_default; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX view_one_default ON public.views USING btree (entity_id) WHERE (is_default = true);


--
-- Name: custom_filters custom_filters_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.custom_filters
    ADD CONSTRAINT custom_filters_entity_id_entities_id_fk FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: dashboard_widgets dashboard_widgets_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dashboard_widgets
    ADD CONSTRAINT dashboard_widgets_page_id_pages_id_fk FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: entities entities_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_page_id_pages_id_fk FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE SET NULL;


--
-- Name: entity_automation_runs entity_automation_runs_automation_id_entity_automations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_automation_runs
    ADD CONSTRAINT entity_automation_runs_automation_id_entity_automations_id_fk FOREIGN KEY (automation_id) REFERENCES public.entity_automations(id) ON DELETE CASCADE;


--
-- Name: entity_automations entity_automations_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_automations
    ADD CONSTRAINT entity_automations_entity_id_entities_id_fk FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: entity_fields entity_fields_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_fields
    ADD CONSTRAINT entity_fields_entity_id_entities_id_fk FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: entity_records entity_records_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_records
    ADD CONSTRAINT entity_records_entity_id_entities_id_fk FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: entity_records entity_records_status_id_entity_statuses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_records
    ADD CONSTRAINT entity_records_status_id_entity_statuses_id_fk FOREIGN KEY (status_id) REFERENCES public.entity_statuses(id) ON DELETE SET NULL;


--
-- Name: entity_statuses entity_statuses_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_statuses
    ADD CONSTRAINT entity_statuses_entity_id_entities_id_fk FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: entity_transitions entity_transitions_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_transitions
    ADD CONSTRAINT entity_transitions_entity_id_entities_id_fk FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: entity_transitions entity_transitions_from_status_id_entity_statuses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_transitions
    ADD CONSTRAINT entity_transitions_from_status_id_entity_statuses_id_fk FOREIGN KEY (from_status_id) REFERENCES public.entity_statuses(id) ON DELETE CASCADE;


--
-- Name: entity_transitions entity_transitions_to_status_id_entity_statuses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entity_transitions
    ADD CONSTRAINT entity_transitions_to_status_id_entity_statuses_id_fk FOREIGN KEY (to_status_id) REFERENCES public.entity_statuses(id) ON DELETE CASCADE;


--
-- Name: google_drive_folders google_drive_folders_parent_id_google_drive_folders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.google_drive_folders
    ADD CONSTRAINT google_drive_folders_parent_id_google_drive_folders_id_fk FOREIGN KEY (parent_id) REFERENCES public.google_drive_folders(id) ON DELETE CASCADE;


--
-- Name: guest_links guest_links_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.guest_links
    ADD CONSTRAINT guest_links_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: local_folders local_folders_parent_id_local_folders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.local_folders
    ADD CONSTRAINT local_folders_parent_id_local_folders_id_fk FOREIGN KEY (parent_id) REFERENCES public.local_folders(id) ON DELETE CASCADE;


--
-- Name: page_fields page_fields_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.page_fields
    ADD CONSTRAINT page_fields_page_id_pages_id_fk FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: page_record_values page_record_values_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.page_record_values
    ADD CONSTRAINT page_record_values_page_id_pages_id_fk FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;


--
-- Name: page_record_values page_record_values_record_id_entity_records_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.page_record_values
    ADD CONSTRAINT page_record_values_record_id_entity_records_id_fk FOREIGN KEY (record_id) REFERENCES public.entity_records(id) ON DELETE CASCADE;


--
-- Name: record_links record_links_relation_id_relations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.record_links
    ADD CONSTRAINT record_links_relation_id_relations_id_fk FOREIGN KEY (relation_id) REFERENCES public.relations(id) ON DELETE CASCADE;


--
-- Name: record_links record_links_source_record_id_entity_records_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.record_links
    ADD CONSTRAINT record_links_source_record_id_entity_records_id_fk FOREIGN KEY (source_record_id) REFERENCES public.entity_records(id) ON DELETE CASCADE;


--
-- Name: record_links record_links_target_record_id_entity_records_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.record_links
    ADD CONSTRAINT record_links_target_record_id_entity_records_id_fk FOREIGN KEY (target_record_id) REFERENCES public.entity_records(id) ON DELETE CASCADE;


--
-- Name: relations relations_source_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.relations
    ADD CONSTRAINT relations_source_entity_id_entities_id_fk FOREIGN KEY (source_entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: relations relations_target_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.relations
    ADD CONSTRAINT relations_target_entity_id_entities_id_fk FOREIGN KEY (target_entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: views views_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.views
    ADD CONSTRAINT views_entity_id_entities_id_fk FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict bCgfGQfKdz0q4AAZpzajcVAbTJE8w17O4nCd9t2ksq1u9H7cYClBy7gZJ1QwwXB

