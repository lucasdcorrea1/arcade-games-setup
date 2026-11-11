'use strict';

// ESTUDOS page of the OFFICE mode: study tracks (AWS first) as modules with steps, kept on the
// cabinet in ~/adz-office/study.json so the progress survives and lives next to the office data.
// The daily work tasks stay in the office's own TAREFAS list; this is the long road.

const SftpClient = require('ssh2-sftp-client');

const L = 'lab'; const R = 'ler'; const S = 'simulado';
const step = (kind, text) => ({ kind, text });
const AWS = {
  id: 'aws-saa', name: 'AWS Solutions Architect Associate (SAA-C03)',
  modules: [
    ['Fundamentos', [step(R, 'Conta, Free Tier, MFA no root e alarme de billing'), step(R, 'Regiões, AZs e edge locations'),
      step(R, 'Modelo de responsabilidade compartilhada'), step(L, 'AWS CLI configurada com perfil e SSO')]],
    ['IAM e segurança', [step(R, 'Usuários, grupos e políticas (least privilege)'), step(R, 'Roles, AssumeRole e acesso entre contas'),
      step(R, 'Políticas JSON: Effect, Action, Resource, Condition'), step(R, 'Organizations e SCPs'),
      step(R, 'KMS, Secrets Manager e Parameter Store'), step(L, 'Role para uma EC2 ler um bucket S3')]],
    ['Computação (EC2)', [step(R, 'Tipos de instância e modelos de preço: on-demand, spot, RI, Savings Plans'),
      step(R, 'EBS, EFS e instance store'), step(R, 'ALB x NLB x GWLB'), step(R, 'Auto Scaling: políticas e health checks'),
      step(L, 'Auto Scaling Group atrás de um ALB')]],
    ['Rede (VPC)', [step(R, 'VPC, subnets e route tables'), step(R, 'Internet Gateway e NAT Gateway'), step(R, 'Security Group x NACL'),
      step(R, 'Peering, Transit Gateway e VPC endpoints'), step(R, 'Route 53: políticas de roteamento'), step(R, 'CloudFront e Global Accelerator'),
      step(L, 'VPC em 2 AZs com subnets pública e privada')]],
    ['Armazenamento (S3)', [step(R, 'Classes de armazenamento e lifecycle'), step(R, 'Versionamento e replicação'),
      step(R, 'Bucket policy, criptografia e presigned URLs'), step(R, 'Storage Gateway, Snow e DataSync'),
      step(L, 'Site estático no S3 com CloudFront')]],
    ['Bancos de dados', [step(R, 'RDS: Multi-AZ x read replicas'), step(R, 'Aurora e Aurora Serverless'),
      step(R, 'DynamoDB: chaves, GSI/LSI, capacidade e streams'), step(R, 'ElastiCache: Redis x Memcached'),
      step(L, 'Tabela DynamoDB alimentada por uma Lambda')]],
    ['Serverless e integração', [step(R, 'Lambda: limites, concorrência e cold start'), step(R, 'API Gateway: REST x HTTP API'),
      step(R, 'SQS, SNS e EventBridge'), step(R, 'Step Functions'), step(L, 'API serverless com deploy via SAM')]],
    ['Containers', [step(R, 'ECS com Fargate x EC2'), step(R, 'ECR e EKS (visão geral)'), step(L, 'Subir um container no Fargate')]],
    ['Monitoramento e IaC', [step(R, 'CloudWatch: métricas, logs e alarmes'), step(R, 'CloudTrail e AWS Config'),
      step(R, 'CloudFormation: stacks, parâmetros e outputs'), step(L, 'Recriar o lab da VPC em CloudFormation')]],
    ['Arquitetura e custo', [step(R, 'Well-Architected: os 6 pilares'), step(R, 'DR: backup, pilot light, warm standby, multi-site'),
      step(R, 'Custo: Cost Explorer, Budgets e escolha de preço')]],
    ['Prova', [step(S, 'Simulado 1 (65 questões) e revisar cada erro'), step(S, 'Simulado 2: meta 75% ou mais'),
      step(S, 'Simulado 3 por domínio fraco'), step(R, 'Agendar a prova')]]
  ]
};

function seed() {
  const t = { id: AWS.id, name: AWS.name, modules: AWS.modules.map(([name, steps], m) => ({ id: `m${m}`, name, steps: steps.map((s, i) => ({ id: `m${m}s${i}`, ...s, done: null })) })) };
  return { tracks: [t] };
}

let cache = null;   // { data, at }
function where(settings) {
  const home = String(settings.romsBase || '/home/pi/RetroPie/roms').replace(/\/RetroPie\/roms\/?$/, '');
  return `${home}/adz-office/study.json`;
}
async function withSftp(settings, fn) {
  const sftp = new SftpClient();
  try {
    await sftp.connect({ host: settings.host, port: Number(settings.port) || 22, username: settings.user, password: settings.password, readyTimeout: 10000 });
    return await fn(sftp);
  } finally { sftp.end().catch(() => {}); }
}

async function load(settings) {
  if (cache && Date.now() - cache.at < 60000) return cache.data;
  const data = await withSftp(settings, async (sftp) => {
    const file = where(settings);
    if (await sftp.exists(file)) return JSON.parse((await sftp.get(file)).toString('utf8'));
    const d = seed();
    await sftp.put(Buffer.from(JSON.stringify(d, null, 2)), file);
    return d;
  });
  cache = { data, at: Date.now() };
  return data;
}

// mark / unmark a step; returns the tracks
async function toggle(settings, stepId) {
  cache = null;
  return withSftp(settings, async (sftp) => {
    const file = where(settings);
    const d = JSON.parse((await sftp.get(file)).toString('utf8'));
    for (const t of d.tracks) for (const m of t.modules) for (const s of m.steps) if (s.id === stepId) s.done = s.done ? null : Date.now();
    await sftp.put(Buffer.from(JSON.stringify(d, null, 2)), file);
    cache = { data: d, at: Date.now() };
    return d;
  });
}

module.exports = { load, toggle };
