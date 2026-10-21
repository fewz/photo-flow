import { MIGRATIONS } from './migrations';

describe('migrations', () => {
  it('creates the phase 1 tables without destroying existing rows', () => {
    const sql = MIGRATIONS.map((migration) => migration.statements.join('\n')).join('\n');
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS photos');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS upload_jobs');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS nextcloud_config');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS app_settings');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS review_actions');
    expect(sql).toContain('idx_upload_jobs_photo');
    expect(sql).toContain('delete_error');
    expect(sql).toContain('backup_before_delete');
    expect(sql).toContain('duplicate_group');
    expect(sql).toContain('perceptual_hash');
    expect(sql).toContain('is_screenshot');
    expect(sql).toContain('blur_flag');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS cloud_folders');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS cloud_photos');
    expect(sql).toContain('ALTER TABLE cloud_photos ADD COLUMN sha256');
    expect(sql).not.toContain('DROP TABLE');
  });
});
