"""Teste real: migrations pendentes, repetição e rollback de migration com erro."""
import os
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
name = 'faceimob-migrations-test-' + uuid.uuid4().hex[:8]
password = uuid.uuid4().hex
env = dict(os.environ, SUPABASE_DB_PASSWORD=password, PGPASSWORD=password)


def run(*args, check=True, **kwargs):
    return subprocess.run(args, check=check, capture_output=True, text=True, **kwargs)


# A mesma imagem oficial em três registros: pull anônimo tem limite por IP e
# os runners do GitHub compartilham IP (09/10/2026: "toomanyrequests" seguidos).
IMAGES = (
    'mirror.gcr.io/library/postgres:17-alpine',
    'public.ecr.aws/docker/library/postgres:17-alpine',
    'postgres:17-alpine',
)


def pull_image():
    for tentativa in range(3):
        for image in IMAGES:
            if run('docker', 'pull', '-q', image, check=False).returncode == 0:
                return image
        time.sleep((tentativa + 1) * 15)
    raise RuntimeError('não consegui baixar o postgres:17-alpine de nenhum registro')


try:
    run('docker', 'run', '-d', '--name', name, '-e', f'POSTGRES_PASSWORD={password}',
        '-p', '127.0.0.1::5432', pull_image())
    for _ in range(60):
        if run('docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', check=False).returncode == 0:
            break
        time.sleep(0.5)
    else:
        raise RuntimeError('Postgres não iniciou')
    port = run('docker', 'port', name, '5432').stdout.strip().split(':')[-1]

    def sql(query):
        return run('docker', 'exec', name, 'psql', '-U', 'postgres', '-tAX', '-c', query).stdout.strip()

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        migrations = root / 'supabase/migrations'
        migrations.mkdir(parents=True)
        (root / 'supabase/config.toml').write_text('project_id = "faceimob-deploy-test"\n[db]\nmajor_version = 17\n')
        (migrations / '20260101000000_first.sql').write_text('CREATE TABLE public.deploy_probe (id int PRIMARY KEY); INSERT INTO public.deploy_probe VALUES (1);')
        command = ['node', str(repo / 'node_modules/supabase/dist/supabase.js'), 'db', 'push', '--yes',
                   '--workdir', str(root), '--db-url', f'postgresql://postgres@127.0.0.1:{port}/postgres?sslmode=disable']
        for _ in range(2):
            result = run(*command, env=env, check=False)
            assert result.returncode == 0, result.stdout + result.stderr
        assert sql('SELECT count(*) FROM public.deploy_probe') == '1'
        assert sql('SELECT count(*) FROM supabase_migrations.schema_migrations') == '1'
        (migrations / '20260102000000_broken.sql').write_text('INSERT INTO public.deploy_probe VALUES (2); SELECT 1/0;')
        assert run(*command, env=env, check=False).returncode != 0
        assert sql('SELECT count(*) FROM public.deploy_probe') == '1', 'Migration com erro deixou dados parciais'
        assert sql('SELECT count(*) FROM supabase_migrations.schema_migrations') == '1', 'Migration com erro foi registrada'
        print('OK: pendentes aplicadas uma vez; erro aborta e desfaz a migration.')
finally:
    run('docker', 'rm', '-f', '-v', name, check=False)
