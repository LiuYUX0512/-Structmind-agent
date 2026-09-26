// ProjectStatusCard — 对话区「当前工程状态」小卡片
// 显示当前参数与方案集摘要，让多轮对话有上下文感
// EXPORTS: ProjectStatusCard

import { memo } from 'react';
import {
  Building2,
  Ruler,
  Activity,
  Landmark,
  Wallet,
  Layers,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { IProjectParams, IStructureScheme } from '@/data/structure';

const BUILDING_TYPE_LABELS: Record<string, string> = {
  residential: '住宅',
  office: '办公楼',
  school: '教学楼',
  factory: '厂房',
  gymnasium: '体育馆',
};

const SEISMIC_LABELS: Record<string, string> = {
  '6': '6度',
  '7': '7度',
  '8': '8度',
  '9': '9度',
};

interface ProjectStatusCardProps {
  params: IProjectParams;
  schemes?: IStructureScheme[];
  recommendedId?: string;
}

function ProjectStatusCard({ params, schemes, recommendedId }: ProjectStatusCardProps) {
  const recommended = schemes?.find((s) => s.id === recommendedId);

  return (
    <Card className="corner-marks border-border/50 bg-gradient-to-br from-card/80 to-background/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-sm bg-primary/15">
              <Building2 className="size-4 text-primary" strokeWidth={1.75} />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">当前工程状态</div>
              <div className="font-mono text-[9px] tracking-wider text-muted-foreground">
                CURRENT PROJECT STATUS
              </div>
            </div>
          </div>
          <Badge
            variant="outline"
            className="border-teal/40 bg-teal/10 text-teal text-[9px] font-medium"
          >
            已加载
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-1">
        {/* 参数网格 */}
        <div className="grid grid-cols-3 gap-1.5 text-[10px]">
          <StatusItem icon={<Ruler className="size-3" />} label="层数" value={`${params.floors}F`} />
          <StatusItem
            icon={<Activity className="size-3" />}
            label="面积"
            value={`${params.area.toLocaleString()}㎡`}
          />
          <StatusItem
            icon={<Landmark className="size-3" />}
            label="设防"
            value={`${params.seismicIntensity}度`}
          />
          <StatusItem
            icon={<Layers className="size-3" />}
            label="场地"
            value={params.soilCategory}
          />
          <StatusItem
            icon={<Wallet className="size-3" />}
            label="预算"
            value={`${params.budget}/㎡`}
          />
          <StatusItem
            icon={<Building2 className="size-3" />}
            label="类型"
            value={BUILDING_TYPE_LABELS[params.buildingType] || params.buildingType}
          />
        </div>

        {/* 推荐方案 */}
        {recommended && (
          <div className="mt-2 border-t border-border/40 pt-2">
            <div className="mb-1 font-mono text-[9px] tracking-wider text-muted-foreground">
              推荐方案 RECOMMENDATION
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-primary">{recommended.name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {recommended.metrics.cost}元/㎡
              </span>
            </div>
            {schemes && (
              <div className="mt-1 font-mono text-[9px] text-muted-foreground">
                候选 {schemes.length} 个方案进行比选
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-sm border border-border/30 bg-background/40 p-1.5">
      <div className="mb-0.5 flex items-center gap-1 text-muted-foreground">
        {icon}
        <span className="text-[9px]">{label}</span>
      </div>
      <div className="font-mono text-[11px] font-bold text-foreground data-number">{value}</div>
    </div>
  );
}

export default memo(ProjectStatusCard);
